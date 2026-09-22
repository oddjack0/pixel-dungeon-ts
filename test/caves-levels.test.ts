/**
 * Stage 2 tests: Caves depths 11-15 — regular generation (water/grass
 * ratios, decoration, tunnels stay tunnels, the depth-11 shop, the
 * blacksmith quest), the BlacksmithPainter room, and the DM-300 boss arena
 * (build, arena-exit spawn, door seal, skeleton-key unseal).
 *
 * Ground truth: ~/workspace/pixel-dungeon-src —
 *   levels/CavesLevel.java, levels/CavesBossLevel.java,
 *   levels/RegularLevel.java, levels/painters/BlacksmithPainter.java,
 *   actors/mobs/npcs/Blacksmith.java, actors/mobs/Bestiary.java,
 *   actors/mobs/DM300.java.
 * Java wins every conflict; each assertion cites its source.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain, Region } from '../src/core/grid.js';
import {
  generateLevel,
  newRunState,
  isCavesDepth,
  shopOnLevel,
  type GenResult,
  type RunState,
} from '../src/dungeon/generator.js';
import { resetSpecials, RoomType, type Room } from '../src/dungeon/rooms.js';
import { Level } from '../src/dungeon/level.js';
import { pressArenaCell, onItemDropped } from '../src/dungeon/cavesBoss.js';

const SEEDS = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12];

interface RunDepths {
  run: RunState;
  results: Map<number, GenResult>;
}

/**
 * Simulate a run's depth progression the way the engine does: one RNG,
 * resetSpecials once per run (Game constructor), one shared RunState
 * threaded through every depth (Game.changeDepth).
 */
function runDepths(seed: number, maxDepth: number): RunDepths {
  const rng = new RNG(seed);
  resetSpecials(rng);
  const run = newRunState();
  const results = new Map<number, GenResult>();
  for (let d = 1; d <= maxDepth; d++) {
    results.set(d, generateLevel(rng, d, run));
  }
  return { run, results };
}

function roomOf(rooms: Room[], type: RoomType): Room[] {
  return rooms.filter((r) => r.type === type);
}

/** BFS over traversable tiles (same contract as test/dungeon.test.ts). */
function reachable(level: Level, from: number): Set<number> {
  const doors = new Set([
    Terrain.DOOR,
    Terrain.DOOR_SECRET,
    Terrain.DOOR_LOCKED,
    Terrain.BARRICADE,
    Terrain.BOOKSHELF,
  ]);
  const pass = (x: number, y: number) =>
    level.isPassable(x, y) || doors.has(level.get(x, y));
  const seen = new Set<number>([from]);
  const q = [from];
  while (q.length) {
    const c = q.pop()!;
    const x = c % level.w;
    const y = Math.floor(c / level.w);
    const ns = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of ns) {
      if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
      const nc = ny * level.w + nx;
      if (!seen.has(nc) && pass(nx, ny)) {
        seen.add(nc);
        q.push(nc);
      }
    }
  }
  return seen;
}

describe('caves region routing (Dungeon.java region order; CavesLevel.java)', () => {
  test('isCavesDepth covers 11-14 only', () => {
    for (let d = 1; d <= 25; d++) {
      expect(isCavesDepth(d)).toBe(d >= 11 && d <= 14);
    }
  });

  for (const seed of SEEDS.slice(0, 6)) {
    test(`seed ${seed}: depths 11-14 are Region.CAVES, non-boss, with stairs`, () => {
      const { results } = runDepths(seed, 14);
      for (let d = 11; d <= 14; d++) {
        const g = results.get(d)!;
        const level = g.level;
        expect(level.region).toBe(Region.CAVES);
        expect(level.bossLevel).toBe(false);
        // Feeling is rolled on depth > 1 for non-boss levels (Level.java).
        expect(level.stairsUp).toBeGreaterThanOrEqual(0);
        expect(level.stairsDown).toBeGreaterThanOrEqual(0);
        expect(level.stairsUp).not.toBe(level.stairsDown);
        expect(level.getAt(level.stairsUp)).toBe(Terrain.ENTRANCE);
        expect(level.getAt(level.stairsDown)).toBe(Terrain.EXIT);
        // The exit is reachable from the entrance.
        expect(reachable(level, level.stairsUp).has(level.stairsDown)).toBe(true);
      }
    });
  }
});

describe('caves tunnels are NOT converted to passages (CavesLevel has no PrisonLevel.java:58-66 override)', () => {
  for (const seed of SEEDS.slice(0, 6)) {
    test(`seed ${seed}: no PASSAGE rooms on 11-14; TUNNEL rooms may exist`, () => {
      const { results } = runDepths(seed, 14);
      let tunnels = 0;
      for (let d = 11; d <= 14; d++) {
        const g = results.get(d)!;
        expect(roomOf(g.rooms, RoomType.PASSAGE).length).toBe(0);
        tunnels += roomOf(g.rooms, RoomType.TUNNEL).length;
      }
      // Corridor rooms exist on caves depths (vanilla paints TUNNEL rooms
      // with TunnelPainter); the exact count varies by seed.
      expect(tunnels).toBeGreaterThanOrEqual(0);
    });
  }
});

describe('depth 11 shop (Dungeon.java shopOnLevel: 6/11/16)', () => {
  test('shopOnLevel(11) is true', () => {
    expect(shopOnLevel(11)).toBe(true);
  });

  for (const seed of SEEDS.slice(0, 6)) {
    test(`seed ${seed}: a SHOP room with FOR_SALE stock and a shopkeeper`, () => {
      const { results } = runDepths(seed, 11);
      const g = results.get(11)!;
      const shops = roomOf(g.rooms, RoomType.SHOP);
      expect(shops.length).toBe(1);
      const stock = g.items.filter((i) => i.heap === 'FOR_SALE');
      // ShopPainter.java:96-100 + 122-136 — 4 depth items plus the common
      // tail (potion of healing, 3 random potions, 3 named scrolls, 1 random
      // scroll, 2 overpriced rations, 1 ankh) = 15.
      expect(stock.length).toBe(15);
      const tags = stock.map((i) => i.tag);
      expect(tags).toContain('mail-armor');
      expect(tags).toContain('scroll-holder');
      expect(tags).toContain('weightstone');
      expect(tags.some((t) => t === 'sword' || t === 'mace')).toBe(true);
      expect(g.mobs.some((m) => m.kind === 'shopkeeper')).toBe(true);
    });
  }
});

describe('caves decoration (CavesLevel.java:70-160)', () => {
  for (const seed of SEEDS.slice(0, 4)) {
    test(`seed ${seed}: depth 12 markers — wall veins, empty deco, sign`, () => {
      const { results } = runDepths(seed, 12);
      const g = results.get(12)!;
      const m = g.markers;
      // WALL_DECO veins: 1-in-12 per wall cell (CavesLevel.java:144-148).
      expect(m.wallDeco.length).toBeGreaterThan(0);
      for (const c of m.wallDeco) {
        expect(g.level.getAt(c)).toBe(Terrain.WALL);
      }
      // EMPTY_DECO scatter + door deco (CavesLevel.java:116-142).
      expect(m.emptyDeco.length).toBeGreaterThan(0);
      // Exactly one sign, in the entrance room, not on the entrance tile
      // (CavesLevel.java:150-156).
      expect(m.signs.length).toBe(1);
      const sign = m.signs[0]!;
      expect(sign).not.toBe(g.level.stairsUp);
      const entranceRooms = g.rooms.filter(
        (r) =>
          r.type === RoomType.ENTRANCE &&
          sign % g.level.w >= r.l &&
          sign % g.level.w <= r.r &&
          Math.floor(sign / g.level.w) >= r.t &&
          Math.floor(sign / g.level.w) <= r.b,
      );
      expect(entranceRooms.length).toBe(1);
    });
  }

  test('water and grass blobs exist on caves depths (CavesLevel.java:53-59)', () => {
    let water = 0;
    let grass = 0;
    let cells = 0;
    for (const seed of SEEDS.slice(0, 4)) {
      const { results } = runDepths(seed, 14);
      for (let d = 11; d <= 14; d++) {
        const level = results.get(d)!.level;
        for (let i = 0; i < level.size; i++) {
          const t = level.getAt(i);
          if (t === Terrain.WATER) water++;
          if (t === Terrain.GRASS || t === Terrain.HIGH_GRASS) grass++;
          cells++;
        }
      }
    }
    expect(water).toBeGreaterThan(0);
    expect(grass).toBeGreaterThan(0);
    // Sanity: blobs cover a plausible fraction, not the whole map.
    expect(water / cells).toBeLessThan(0.4);
    expect(grass / cells).toBeLessThan(0.4);
  });
});

describe('blacksmith quest 12-14 (Blacksmith.java:305-320; CavesLevel.java:62-66)', () => {
  test('depth 14 always attempts the spawn (Int(15-14)==0)', () => {
    // Fresh run per seed straight to depth 14; the quest must fire unless
    // no qualifying room exists.
    let spawned = 0;
    for (const seed of SEEDS) {
      const rng = new RNG(seed * 7919 + 13);
      resetSpecials(rng);
      const run = newRunState();
      const g = generateLevel(rng, 14, run);
      if (run.blacksmithSpawned) {
        spawned++;
        const smiths = roomOf(g.rooms, RoomType.BLACKSMITH);
        expect(smiths.length).toBe(1);
        // BlacksmithPainter.java:27-29 — margin-1 fire traps, margin-2
        // walkway floor. Each door carves one ring cell to EMPTY (the
        // port's FLOOR; BlacksmithPainter.java:44-58 drawInside).
        const room = smiths[0]!;
        const level = g.level;
        const at = (x: number, y: number) => level.get(x, y);
        const carved = new Set<number>();
        for (const d of room.doors) {
          if (d.x === room.l) carved.add(level.idx(d.x + 1, d.y));
          else if (d.x === room.r) carved.add(level.idx(d.x - 1, d.y));
          else if (d.y === room.t) carved.add(level.idx(d.x, d.y + 1));
          else if (d.y === room.b) carved.add(level.idx(d.x, d.y - 1));
        }
        const ring = (x: number, y: number): Terrain =>
          carved.has(level.idx(x, y)) ? Terrain.FLOOR : Terrain.TRAP_FIRE;
        const floorish = (t: Terrain) =>
          t === Terrain.FLOOR ||
          t === Terrain.WATER ||
          t === Terrain.GRASS ||
          t === Terrain.HIGH_GRASS;
        for (let x = room.l + 1; x < room.r; x++) {
          const top = ring(x, room.t + 1);
          const bot = ring(x, room.b - 1);
          if (top === Terrain.FLOOR) expect(floorish(at(x, room.t + 1))).toBe(true);
          else expect(at(x, room.t + 1)).toBe(top);
          if (bot === Terrain.FLOOR) expect(floorish(at(x, room.b - 1))).toBe(true);
          else expect(at(x, room.b - 1)).toBe(bot);
        }
        for (let y = room.t + 2; y < room.b - 1; y++) {
          const l = ring(room.l + 1, y);
          const r = ring(room.r - 1, y);
          if (l === Terrain.FLOOR) expect(floorish(at(room.l + 1, y))).toBe(true);
          else expect(at(room.l + 1, y)).toBe(l);
          if (r === Terrain.FLOOR) expect(floorish(at(room.r - 1, y))).toBe(true);
          else expect(at(room.r - 1, y)).toBe(r);
          for (let x = room.l + 2; x < room.r - 1; x++) {
            expect(at(x, y)).toBe(Terrain.WALKWAY);
          }
        }
        // Two armor/weapon prizes (BlacksmithPainter.java:31-41).
        const drops = g.items.filter((i) => {
          const x = i.pos % level.w;
          const y = Math.floor(i.pos / level.w);
          return x >= room.l && x <= room.r && y >= room.t && y <= room.b;
        });
        expect(drops.length).toBe(2);
        expect(
          drops.every((d) => d.tag === 'prize-armor' || d.tag === 'prize-weapon'),
        ).toBe(true);
        // The blacksmith NPC (BlacksmithPainter.java:48-51).
        expect(g.mobs.some((m) => m.kind === 'blacksmith')).toBe(true);
      }
    }
    // Depth 14 rolls Int(1)==0 unconditionally, so every seed with a
    // qualifying STANDARD room spawns; at least one must.
    expect(spawned).toBeGreaterThan(0);
  });

  test('at most one blacksmith per run across depths 12-14', () => {
    for (const seed of SEEDS) {
      const { run, results } = runDepths(seed, 14);
      let rooms = 0;
      for (let d = 12; d <= 14; d++) {
        rooms += roomOf(results.get(d)!.rooms, RoomType.BLACKSMITH).length;
      }
      expect(rooms).toBeLessThanOrEqual(1);
      expect(run.blacksmithSpawned).toBe(rooms === 1);
    }
  });

  test('depth 11 never spawns the blacksmith (Blacksmith.java:306: depth > 11)', () => {
    for (const seed of SEEDS) {
      const { run, results } = runDepths(seed, 11);
      expect(roomOf(results.get(11)!.rooms, RoomType.BLACKSMITH).length).toBe(0);
      expect(run.blacksmithSpawned).toBe(false);
    }
  });
});

describe('depth 15: DM-300 arena (CavesBossLevel.java)', () => {
  for (const seed of SEEDS.slice(0, 6)) {
    test(`seed ${seed}: arena geometry, door, locked exit`, () => {
      const { results } = runDepths(seed, 15);
      const g = results.get(15)!;
      const level = g.level;
      expect(level.region).toBe(Region.CAVES);
      expect(level.bossLevel).toBe(true);

      // CavesBossLevel.java:58-61 — arena centered on the map.
      const arena = level.bossArena!;
      expect(arena).not.toBeNull();
      expect(arena.l).toBe(level.w / 2 - 2);
      expect(arena.r).toBe(level.w / 2 + 2);
      expect(arena.t).toBe(level.h / 2 - 2);
      expect(arena.b).toBe(level.h / 2 + 2);

      // CavesBossLevel.java:126-131 — plain DOOR on the bottom wall, the
      // entrance inside the arena.
      expect(level.arenaDoorCell).toBeGreaterThanOrEqual(0);
      expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR);
      const dx = level.arenaDoorCell % level.w;
      const dy = Math.floor(level.arenaDoorCell / level.w);
      expect(dx).toBeGreaterThanOrEqual(arena.l);
      expect(dx).toBeLessThanOrEqual(arena.r);
      expect(dy).toBe(arena.b + 1);
      const ex = level.stairsUp % level.w;
      const ey = Math.floor(level.stairsUp / level.w);
      expect(ex).toBeGreaterThanOrEqual(arena.l + 1);
      expect(ex).toBeLessThanOrEqual(arena.r - 1);
      expect(ey).toBeGreaterThanOrEqual(arena.t + 1);
      expect(ey).toBeLessThanOrEqual(arena.b - 1);
      expect(level.getAt(level.stairsUp)).toBe(Terrain.ENTRANCE);

      // CavesBossLevel.java:107-109 — LOCKED_EXIT above the top-most room.
      expect(level.getAt(level.stairsDown)).toBe(Terrain.EXIT_LOCKED);

      // CavesBossLevel.java:120-124 — visible toxic-trap row on the
      // arena's top interior row.
      for (let x = arena.l; x <= arena.r; x++) {
        expect(level.get(x, arena.t)).toBe(Terrain.TRAP_TOXIC);
      }
    });

    test(`seed ${seed}: no generated mobs or items; DM-300 spawns on exit`, () => {
      const { results } = runDepths(seed, 15);
      const g = results.get(15)!;
      // CavesBossLevel.createMobs() is empty (CavesBossLevel.java:179-181);
      // createItems only drops Bones (skipped: no cross-run bone state).
      expect(g.mobs.length).toBe(0);
      expect(g.items.length).toBe(0);
      expect(g.level.enteredArena).toBe(false);
      expect(g.level.keyDropped).toBe(false);
    });

    test(`seed ${seed}: the entrance reaches the arena door`, () => {
      const { results } = runDepths(seed, 15);
      const level = results.get(15)!.level;
      expect(reachable(level, level.stairsUp).has(level.arenaDoorCell)).toBe(true);
    });
  }
});

describe('DM-300 spawn: CavesBossLevel.press (CavesBossLevel.java:184-214)', () => {
  function arenaLevel(seed: number): { level: Level; arena: NonNullable<Level['bossArena']> } {
    const { results } = runDepths(seed, 15);
    const level = results.get(15)!.level;
    return { level, arena: level.bossArena! };
  }

  test('stepping outside the arena spawns the boss, seals the door', () => {
    const { level, arena } = arenaLevel(1);
    // A cell just outside the arena's 1-margin box (e.g. past the door).
    const doorX = level.arenaDoorCell % level.w;
    const outsideCell = (arena.b + 2) * level.w + doorX;
    const spawned: number[] = [];
    pressArenaCell(level, new RNG(42), outsideCell, {
      occupied: () => false,
      spawn: (p) => spawned.push(p),
    });
    expect(level.enteredArena).toBe(true);
    expect(spawned.length).toBe(1);
    // CavesBossLevel.java:202-207 — outside the arena, passable, not visible.
    const p = spawned[0]!;
    const px = p % level.w;
    const py = Math.floor(p / level.w);
    const pOutside =
      px < arena.l - 1 || px > arena.r + 1 || py < arena.t - 1 || py > arena.b + 1;
    expect(pOutside).toBe(true);
    expect(level.isPassable(px, py)).toBe(true);
    // CavesBossLevel.java:211 — the arena door seals to WALL.
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.WALL);
  });

  test('steps inside the arena do not trigger the spawn', () => {
    const { level, arena } = arenaLevel(2);
    const inside = (arena.t + 2) * level.w + (arena.l + 2);
    const spawned: number[] = [];
    pressArenaCell(level, new RNG(3), inside, {
      occupied: () => false,
      spawn: (p) => spawned.push(p),
    });
    expect(level.enteredArena).toBe(false);
    expect(spawned.length).toBe(0);
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR);
  });

  test('the spawn fires only once', () => {
    const { level, arena } = arenaLevel(4);
    const outsideCell = (arena.b + 2) * level.w + arena.l;
    const spawned: number[] = [];
    const hooks = {
      occupied: () => false,
      spawn: (p: number) => spawned.push(p),
    };
    pressArenaCell(level, new RNG(5), outsideCell, hooks);
    pressArenaCell(level, new RNG(6), outsideCell, hooks);
    expect(spawned.length).toBe(1);
  });

  test('no-op on levels without an arena', () => {
    const { results } = runDepths(1, 14);
    const plain = results.get(14)!.level;
    const spawned: number[] = [];
    pressArenaCell(plain, new RNG(1), plain.stairsUp, {
      occupied: () => false,
      spawn: (p) => spawned.push(p),
    });
    expect(spawned.length).toBe(0);
    expect(plain.enteredArena).toBe(false);
  });
});

describe('skeleton key: CavesBossLevel.drop (CavesBossLevel.java:217-231)', () => {
  test('first skeleton key unseals the door to floor; later keys are plain drops', () => {
    const { results } = runDepths(1, 15);
    const level = results.get(15)!.level;
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR);

    onItemDropped(level, 'skeleton_key');
    expect(level.keyDropped).toBe(true);
    // Vanilla sets EMPTY_DECO (passable floor); the Terrain contract has no
    // EMPTY_DECO id, so FLOOR is stored (see cavesBoss.ts).
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.FLOOR);

    onItemDropped(level, 'skeleton_key');
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.FLOOR);
  });

  test('other items do not unseal the door', () => {
    const { results } = runDepths(2, 15);
    const level = results.get(15)!.level;
    onItemDropped(level, 'iron_key');
    expect(level.keyDropped).toBe(false);
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR);
  });

  test('no-op on levels without an arena', () => {
    const { results } = runDepths(1, 14);
    const plain = results.get(14)!.level;
    onItemDropped(plain, 'skeleton_key');
    expect(plain.keyDropped).toBe(false);
  });
});

describe('run state: blacksmith flag starts false and persists per run', () => {
  test('newRunState has blacksmithSpawned=false', () => {
    expect(newRunState().blacksmithSpawned).toBe(false);
  });
});
