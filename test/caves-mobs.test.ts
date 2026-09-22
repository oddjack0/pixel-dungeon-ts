/**
 * Stage 2 tests: DM-300 mechanics (src/mechanics/dm300.ts) and the
 * CavesBossLevel arena runtime (src/dungeon/cavesBoss.ts) — the press/drop
 * ports Worker 1's generation exposes and the spawn hookup the content
 * layer plugs into (actions.ts depth-15 branch).
 *
 * Ground truth: ~/workspace/pixel-dungeon-src —
 *   actors/mobs/DM300.java, levels/CavesBossLevel.java.
 * Java wins every conflict; each assertion cites its source.
 *
 * NOTE: content-layer assertions (Bestiary depth 11-14 spawn tables,
 * the blacksmith MobKind resolver, DM300Mob behavior) live behind the
 * content import chain, which is currently broken by Worker 4's
 * in-progress potions.ts/scrolls.ts (they import `tickFlavourBuff`,
 * removed from mechanics/buffs.ts by the buffs refactor). Those tests
 * land once the chain loads again; the wiring itself is typechecked.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain } from '../src/core/grid.js';
import { Level, newRunState } from '../src/dungeon/level.js';
import { generateLevel } from '../src/dungeon/generator.js';
import { resetSpecials } from '../src/dungeon/rooms.js';
import {
  DM300_ATTACK,
  DM300_DEFENSE,
  DM300_DR,
  DM300_DMG_MAX,
  DM300_DMG_MIN,
  DM300_EXP,
  DM300_GAS_SEED,
  DM300_HT,
  DM300_IMMUNITIES,
  DM300_MAX_LVL,
  DM300_PARALYSIS_TURNS,
  DM300_RESISTANCES,
  dm300DamageRoll,
  dm300MoveCell,
  dm300Repair,
} from '../src/mechanics/dm300.js';
import {
  pressArenaCell,
  onItemDropped,
} from '../src/dungeon/cavesBoss.js';

describe('DM-300 stats (DM300.java:54-65)', () => {
  test('HP/HT 200, def 18, atk 28, dr 10, EXP 30, maxLvl 30', () => {
    expect(DM300_HT).toBe(200);
    expect(DM300_DEFENSE).toBe(18);
    expect(DM300_ATTACK).toBe(28);
    expect(DM300_DR).toBe(10);
    expect(DM300_EXP).toBe(30);
    expect(DM300_MAX_LVL).toBe(30); // default maxLvl 30 (Mob.java:69)
  });
  test('damage die NormalIntRange(18,24) (DM300.java:64)', () => {
    expect([DM300_DMG_MIN, DM300_DMG_MAX]).toEqual([18, 24]);
    const rng = new RNG(7);
    for (let i = 0; i < 200; i++) {
      const d = dm300DamageRoll(rng);
      expect(d).toBeGreaterThanOrEqual(18);
      expect(d).toBeLessThanOrEqual(24);
    }
  });
  test('resists Death + Psionic Blast, immune to Toxic Gas (DM300.java:156-172)', () => {
    expect([...DM300_RESISTANCES]).toEqual(['death', 'psionic_blast']);
    expect([...DM300_IMMUNITIES]).toEqual(['toxic_gas']);
  });
  test('act() seeds Toxic Gas 30 (DM300.java:78-82)', () => {
    expect(DM300_GAS_SEED).toBe(30);
  });
  test('move() paralysis lasts 2 turns (DM300.java:114-116)', () => {
    expect(DM300_PARALYSIS_TURNS).toBe(2);
  });
});

describe('DM-300 repair + rock-burst cell (DM300.java:84-116)', () => {
  test('repair heals Random.Int(1, HT-HP) (DM300.java:86-91)', () => {
    const rng = new RNG(11);
    for (let i = 0; i < 100; i++) {
      const hp = dm300Repair(rng, 150, 200);
      expect(hp).toBeGreaterThanOrEqual(151);
      expect(hp).toBeLessThanOrEqual(199); // never quite full: [1, HT-HP)
    }
  });
  test('move cell is one of the 8 neighbors or -1 off-map (DM300.java:93-116)', () => {
    const rng = new RNG(13);
    const w = 32;
    const h = 32;
    // interior cell: always a valid neighbor
    for (let i = 0; i < 50; i++) {
      const cell = dm300MoveCell(rng, 16 * w + 16, w, h);
      expect(cell).not.toBe(-1);
      const dx = Math.abs((cell % w) - 16);
      const dy = Math.abs(Math.floor(cell / w) - 16);
      expect(Math.max(dx, dy)).toBe(1);
      expect(cell).not.toBe(16 * w + 16);
    }
  });
});

/** Build a real depth-15 boss level via the generator (Worker 1). */
function bossLevel(seed: number): Level {
  const rng = new RNG(seed);
  resetSpecials(rng);
  const run = newRunState();
  let lvl: Level | null = null;
  for (let d = 1; d <= 15; d++) {
    lvl = generateLevel(rng, d, run).level;
  }
  expect(lvl!.depth).toBe(15);
  expect(lvl!.bossArena).not.toBeNull();
  return lvl!;
}

describe('DM-300 spawn: CavesBossLevel.press (CavesBossLevel.java:184-214)', () => {
  /** An in-bounds cell clearly outside the entrance room. */
  function outsideCell(level: Level): number {
    const arena = level.bossArena!;
    const y = Math.floor((arena.t + arena.b) / 2);
    const x = arena.r + 2 < level.w ? arena.r + 2 : arena.l - 2;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(level.w);
    return y * level.w + x;
  }

  test('first step outside the entrance room spawns via hooks.spawn', () => {
    const level = bossLevel(42);
    const rng = new RNG(99);
    const arena = level.bossArena!;
    const cell = outsideCell(level);
    const spawned: number[] = [];
    pressArenaCell(level, rng, cell, {
      occupied: () => false,
      spawn: (pos) => spawned.push(pos),
    });
    expect(level.enteredArena).toBe(true);
    expect(spawned).toHaveLength(1);
    // The boss cell is passable, outside the room, and non-visible.
    const p = spawned[0];
    const px = p % level.w;
    const py = Math.floor(p / level.w);
    expect(level.isPassable(px, py)).toBe(true);
    expect(
      px < arena.l - 1 || px > arena.r + 1 || py < arena.t - 1 || py > arena.b + 1,
    ).toBe(true);
  });

  test('steps inside the arena do not trigger the spawn', () => {
    const level = bossLevel(43);
    const rng = new RNG(99);
    const arena = level.bossArena!;
    const cx = Math.floor((arena.l + arena.r) / 2);
    const cy = Math.floor((arena.t + arena.b) / 2);
    const spawned: number[] = [];
    pressArenaCell(level, rng, cy * level.w + cx, {
      occupied: () => false,
      spawn: (pos) => spawned.push(pos),
    });
    expect(level.enteredArena).toBe(false);
    expect(spawned).toHaveLength(0);
  });

  test('the spawn fires only once; the door seals to WALL', () => {
    const level = bossLevel(44);
    const rng = new RNG(99);
    const arena = level.bossArena!;
    const doorBefore = level.getAt(level.arenaDoorCell);
    expect(doorBefore).not.toBe(Terrain.WALL);
    const cell = outsideCell(level);
    const spawned: number[] = [];
    const hooks = {
      occupied: () => false,
      spawn: (pos: number) => spawned.push(pos),
    };
    pressArenaCell(level, rng, cell, hooks);
    pressArenaCell(level, rng, cell, hooks);
    expect(spawned).toHaveLength(1);
    // CavesBossLevel.java:211: set(arenaDoor, Terrain.WALL)
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.WALL);
  });

  test('no-op on levels without an arena', () => {
    const level = new Level(16, 16);
    const rng = new RNG(1);
    const spawned: number[] = [];
    pressArenaCell(level, rng, 5, {
      occupied: () => false,
      spawn: (pos) => spawned.push(pos),
    });
    expect(spawned).toHaveLength(0);
  });
});

describe('skeleton key: CavesBossLevel.drop (CavesBossLevel.java:217-231)', () => {
  test('first skeleton key unseals the door to floor; later keys are plain drops', () => {
    const level = bossLevel(45);
    // Collapse the door first (as press does).
    level.set(
      level.arenaDoorCell % level.w,
      Math.floor(level.arenaDoorCell / level.w),
      Terrain.WALL,
    );
    onItemDropped(level, 'skeleton_key');
    // Vanilla sets EMPTY_DECO; the port stores EMPTY_DECO as FLOOR
    // (painters.ts:59).
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.FLOOR);
    expect(level.keyDropped).toBe(true);
    // Second key: no further change.
    level.set(
      level.arenaDoorCell % level.w,
      Math.floor(level.arenaDoorCell / level.w),
      Terrain.WALL,
    );
    onItemDropped(level, 'skeleton_key');
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.WALL);
  });

  test('other items do not unseal the door', () => {
    const level = bossLevel(46);
    level.set(
      level.arenaDoorCell % level.w,
      Math.floor(level.arenaDoorCell / level.w),
      Terrain.WALL,
    );
    onItemDropped(level, 'potion_healing');
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.WALL);
    expect(level.keyDropped).toBe(false);
  });

  test('boss level is depth 15', () => {
    expect(bossLevel(47).depth).toBe(15);
  });
});
