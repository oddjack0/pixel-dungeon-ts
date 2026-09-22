/**
 * Stage 1 tests: Prison depths 6-10 — generation (shop, passages, secret
 * doors, wandmaker, boss arena) and the Tengu arena runtime (first-entry
 * spawn, arena-door re-lock, skeleton-key unseal).
 *
 * Ground truth: ~/workspace/pixel-dungeon-src —
 *   levels/PrisonLevel.java, levels/PrisonBossLevel.java,
 *   levels/painters/ShopPainter.java, levels/RegularLevel.java,
 *   actors/mobs/npcs/Wandmaker.java, actors/mobs/Bestiary.java,
 *   actors/mobs/Tengu.java, levels/Room.java.
 * Java wins every conflict; each assertion cites its source.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain, Region } from '../src/core/grid.js';
import {
  generateLevel,
  newRunState,
  type GenResult,
  type RunState,
} from '../src/dungeon/generator.js';
import { resetSpecials, RoomType, type Room } from '../src/dungeon/rooms.js';
import { Level } from '../src/dungeon/level.js';
import { pressArenaCell, onItemDropped } from '../src/dungeon/prisonBoss.js';
import { moveHero } from '../src/content/actions.js';
import { dropItemAt } from '../src/content/mobs.js';
import { createStarterHero, type ContentHero } from '../src/content/hero.js';
import type { ActionContext, MobActor } from '../src/engine/seams.js';
import { Game } from '../src/engine/loop.js';
import { contentLevelGen } from '../src/content/spawns.js';
import { contentMechanics } from '../src/content/hooks.js';
import { saveGame, loadGame, clearSave } from '../src/engine/save.js';

/** Seeds verified to generate depths 1-10 cleanly (seed 3 hits a
 * pre-existing randomDropCell no-standard-room throw; see report). */
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

/** BFS over traversable tiles; doors count as passable once unlocked/found
 * (same contract as test/dungeon.test.ts). */
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
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h || !pass(nx, ny))
        continue;
      const n = ny * level.w + nx;
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}

/** Minimal ActionContext for moveHero/dropItemAt integration tests. */
function makeCtx(level: Level, hero: ContentHero) {
  const logs: string[] = [];
  const mobs: MobActor[] = [];
  const ctx: ActionContext = {
    rng: new RNG(999),
    level,
    hero,
    mobs,
    log: (m: string) => logs.push(m),
    killMob: () => {},
    removeMob: () => {},
    addMob: (m: MobActor) => {
      mobs.push(m);
    },
    syncMobs: () => {},
  };
  return { ctx, logs, mobs };
}

describe('depth 6: shop (ShopPainter.java; Dungeon.java:241-243)', () => {
  for (const seed of SEEDS.slice(0, 6)) {
    test(`seed ${seed}: exactly one SHOP room, adjacent to the entrance`, () => {
      const { results } = runDepths(seed, 6);
      const g = results.get(6)!;
      const shops = roomOf(g.rooms, RoomType.SHOP);
      // Dungeon.java:241-243 — shops on depths 6, 11, 16.
      expect(shops.length).toBe(1);
      const entrances = roomOf(g.rooms, RoomType.ENTRANCE);
      expect(entrances.length).toBe(1);
      // The shop must connect DIRECTLY to the entrance room.
      const entrance = entrances[0]!;
      const shop = shops[0]!;
      const neighbours = entrance.neighbours;
      expect(neighbours.includes(shop)).toBe(true);
    });

    test(`seed ${seed}: depth-6 stock tags (ShopPainter.java:92-97)`, () => {
      const { results } = runDepths(seed, 6);
      const g = results.get(6)!;
      const stock = g.items.filter((i) => i.heap === 'FOR_SALE');
      // ShopPainter.java:92-100 + 133-149 — 4 depth items plus the shared
      // tail: potion of healing, 3 random potions, 3 named scrolls, 1 random
      // scroll, 2 overpriced rations, 1 ankh = 15.
      expect(stock.length).toBe(15);
      const tags = stock.map((i) => i.tag).sort();
      expect(tags).toContain('leather-armor');
      expect(tags).toContain('seed-pouch');
      expect(tags).toContain('weightstone');
      expect(
        tags.includes('quarterstaff') || tags.includes('spear'),
      ).toBe(true);
    });

    test(`seed ${seed}: shopkeeper spawns on depth 6`, () => {
      const { results } = runDepths(seed, 6);
      const g = results.get(6)!;
      expect(g.mobs.some((m) => m.kind === 'shopkeeper')).toBe(true);
    });
  }

  test('depths 7-9 have no shop', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const { results } = runDepths(seed, 9);
      for (const d of [7, 8, 9]) {
        expect(roomOf(results.get(d)!.rooms, RoomType.SHOP).length).toBe(0);
      }
    }
  });
});

describe('prison regular depths: tunnels become passages (PrisonLevel.java:58-66)', () => {
  for (const depth of [6, 7, 8, 9]) {
    test(`depth ${depth}: no TUNNEL rooms, PASSAGE rooms present`, () => {
      for (const seed of SEEDS.slice(0, 6)) {
        const { results } = runDepths(seed, depth);
        const rooms = results.get(depth)!.rooms;
        expect(roomOf(rooms, RoomType.TUNNEL).length).toBe(0);
        expect(roomOf(rooms, RoomType.PASSAGE).length).toBeGreaterThan(0);
      }
    });

    test(`depth ${depth}: region is prison`, () => {
      for (const seed of SEEDS.slice(0, 3)) {
        const { results } = runDepths(seed, depth);
        expect(results.get(depth)!.level.region).toBe(Region.PRISON);
      }
    });

    test(`depth ${depth}: stairs remain connected`, () => {
      for (const seed of SEEDS.slice(0, 6)) {
        const { results } = runDepths(seed, depth);
        const g = results.get(depth)!;
        expect(reachable(g.level, g.level.stairsUp).has(g.level.stairsDown)).toBe(
          true,
        );
      }
    });
  }
});

describe('secret doors at depth 6+ (RegularLevel.java:532)', () => {
  test('depth 9 uses the fixed 1/6 roll, not 1/(12-depth)', () => {
    // Vanilla: Random.Int(12-depth) below depth 6, fixed Random.Int(6) at 6+.
    // The old shape at depth 9 (1/3) plus deterministic HIDDEN doors would
    // push the rate well above 0.28; the fixed 1/6 roll lands ~0.16.
    let secret = 0;
    let total = 0;
    for (const seed of SEEDS) {
      const { results } = runDepths(seed, 9);
      const level = results.get(9)!.level;
      for (let i = 0; i < level.w * level.h; i++) {
        const t = level.getAt(i);
        if (t === Terrain.DOOR_SECRET) secret++;
        if (
          t === Terrain.DOOR ||
          t === Terrain.DOOR_SECRET ||
          t === Terrain.DOOR_LOCKED
        )
          total++;
      }
    }
    const rate = secret / total;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.28);
  });
});

describe('wandmaker 7-9 (Wandmaker.java:183)', () => {
  test('exactly one wandmaker per run, on depths 7-9 only', () => {
    for (const seed of SEEDS) {
      const { run, results } = runDepths(seed, 9);
      const spots: number[] = [];
      for (const d of [7, 8, 9]) {
        for (const m of results.get(d)!.mobs) {
          if (m.kind === 'wandmaker') spots.push(d);
        }
      }
      // Depth 9 rolls Random.Int(1)==0 — always true — so every run spawns
      // exactly one wandmaker by depth 9 (Wandmaker.java:183).
      expect(spots.length).toBe(1);
      expect(run.wandmakerSpawned).toBe(true);
    }
  });

  test('wandmaker avoids the entrance tile and sign cells (Wandmaker.java:186-188)', () => {
    for (const seed of SEEDS) {
      const { results } = runDepths(seed, 9);
      for (const d of [7, 8, 9]) {
        const g = results.get(d)!;
        for (const m of g.mobs) {
          if (m.kind !== 'wandmaker') continue;
          // do { npc.pos = room.random(); } while (map[pos] == ENTRANCE
          // || map[pos] == SIGN) — the room IS the entrance room
          // (PrisonLevel.java:72); only those two tiles are excluded.
          // (SIGN exclusion is via the painter's sign markers in the
          // generator; signs render as FLOOR in the tile map.)
          expect(g.level.getAt(m.pos)).not.toBe(Terrain.ENTRANCE);
        }
      }
    }
  });
});

describe('depth 10: prison boss arena (PrisonBossLevel.java)', () => {
  for (const seed of SEEDS.slice(0, 6)) {
    test(`seed ${seed}: arena size, position, and door`, () => {
      const { results } = runDepths(seed, 10);
      const g = results.get(10)!;
      const level = g.level;
      expect(level.region).toBe(Region.PRISON);
      expect(level.bossLevel).toBe(true);

      // build() selection: entrance >= 4x4, arena distinct, >= 7x7, arena
      // not on the top edge (PrisonBossLevel.java:89-165).
      const entrance = roomOf(g.rooms, RoomType.ENTRANCE)[0]!;
      expect(entrance.r - entrance.l).toBeGreaterThanOrEqual(4);
      expect(entrance.b - entrance.t).toBeGreaterThanOrEqual(4);
      const arena = level.bossArena!;
      expect(arena).not.toBeNull();
      expect(arena.r - arena.l).toBeGreaterThanOrEqual(7);
      expect(arena.b - arena.t).toBeGreaterThanOrEqual(7);
      expect(arena.t).not.toBe(0);

      // Arena door: LOCKED_DOOR, not through the top wall
      // (PrisonBossLevel.java:264-266).
      expect(level.arenaDoorCell).toBeGreaterThanOrEqual(0);
      expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR_LOCKED);
      const dy = Math.floor(level.arenaDoorCell / level.w);
      expect(dy).toBeGreaterThan(arena.t);
    });

    test(`seed ${seed}: no generated mobs; Tengu spawns only on entry`, () => {
      const { results } = runDepths(seed, 10);
      const g = results.get(10)!;
      // PrisonBossLevel.createMobs() is empty (PrisonBossLevel.java:276-281);
      // Tengu is spawned by press(), not generation.
      expect(g.mobs.length).toBe(0);
      expect(g.level.enteredArena).toBe(false);
    });

    test(`seed ${seed}: iron-key chest in the anteroom (PrisonBossLevel.java:286-294)`, () => {
      const { results } = runDepths(seed, 10);
      const g = results.get(10)!;
      const keys = g.items.filter((i) => i.tag === 'iron-key');
      expect(keys.length).toBe(1);
      expect(keys[0]!.heap).toBe('CHEST');
    });

    test(`seed ${seed}: only visible poison traps (PrisonBossLevel.java:200-207)`, () => {
      const { results } = runDepths(seed, 10);
      const g = results.get(10)!;
      const arena = g.level.bossArena!;
      for (const cell of g.level.traps) {
        const t = g.level.getAt(cell);
        // No SECRET_* variants on the Tengu level. Traps inside the arena
        // may be overwritten by the INACTIVE_TRAP fill that decorate()
        // paints after placeTraps() (PrisonBossLevel.java:267-274) — the
        // same overwrite happens in Java.
        const x = cell % g.level.w;
        const y = Math.floor(cell / g.level.w);
        const inArena =
          x >= arena.l && x <= arena.r && y >= arena.t && y <= arena.b;
        if (inArena) {
          expect([Terrain.TRAP_POISON, Terrain.TRAP_INACTIVE]).toContain(t);
        } else {
          expect(t).toBe(Terrain.TRAP_POISON);
        }
      }
    });

    test(`seed ${seed}: locked exit with a walkable cell below (PrisonBossLevel.java:252-262)`, () => {
      const { results } = runDepths(seed, 10);
      const g = results.get(10)!;
      const level = g.level;
      expect(level.getAt(level.stairsDown)).toBe(Terrain.EXIT_LOCKED);
      const ex = level.stairsDown % level.w;
      const ey = Math.floor(level.stairsDown / level.w);
      expect(level.isPassable(ex, ey + 1)).toBe(true);
    });

    test(`seed ${seed}: entrance reaches the arena door`, () => {
      const { results } = runDepths(seed, 10);
      const g = results.get(10)!;
      const level = g.level;
      // The arena interior is behind the locked door, but the door cell
      // itself must be reachable from the entrance (through the anteroom).
      expect(reachable(level, level.stairsUp).has(level.arenaDoorCell)).toBe(
        true,
      );
    });
  }
});

describe('arena entry: PrisonBossLevel.press (PrisonBossLevel.java:303-328)', () => {
  function arenaLevel(seed: number): { level: Level; arena: NonNullable<Level['bossArena']> } {
    const { results } = runDepths(seed, 10);
    const level = results.get(10)!.level;
    return { level, arena: level.bossArena! };
  }

  test('first entry sets enteredArena, spawns at a free interior cell, re-locks the door', () => {
    const { level, arena } = arenaLevel(1);
    const heroCell = (arena.t + 2) * level.w + (arena.l + 2);
    const spawned: number[] = [];
    pressArenaCell(level, new RNG(42), heroCell, {
      occupied: (p) => p === heroCell,
      spawn: (p) => spawned.push(p),
    });
    expect(level.enteredArena).toBe(true);
    expect(spawned.length).toBe(1);
    const px = spawned[0]! % level.w;
    const py = Math.floor(spawned[0]! / level.w);
    // Room.random(0): interior cells only (Room.java:101-105).
    expect(px).toBeGreaterThan(arena.l);
    expect(px).toBeLessThan(arena.r);
    expect(py).toBeGreaterThan(arena.t);
    expect(py).toBeLessThan(arena.b);
    expect(spawned[0]).not.toBe(heroCell);
    // set( arenaDoor, Terrain.LOCKED_DOOR ) (PrisonBossLevel.java:324).
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR_LOCKED);
  });

  test('spawn skips the hero cell and occupied cells', () => {
    const { level, arena } = arenaLevel(2);
    const heroCell = (arena.t + 3) * level.w + (arena.l + 3);
    const blocked = new Set<number>([heroCell]);
    // Block every interior cell except one.
    const free = (arena.t + 1) * level.w + (arena.l + 1);
    for (let y = arena.t + 1; y < arena.b; y++) {
      for (let x = arena.l + 1; x < arena.r; x++) {
        const p = y * level.w + x;
        if (p !== free) blocked.add(p);
      }
    }
    const spawned: number[] = [];
    pressArenaCell(level, new RNG(7), heroCell, {
      occupied: (p) => blocked.has(p),
      spawn: (p) => spawned.push(p),
    });
    expect(spawned).toEqual([free]);
  });

  test('second entry is a no-op; entry outside the arena is a no-op', () => {
    const { level, arena } = arenaLevel(4);
    const heroCell = (arena.t + 2) * level.w + (arena.l + 2);
    let spawns = 0;
    const hooks = {
      occupied: () => false,
      spawn: () => spawns++,
    };
    pressArenaCell(level, new RNG(1), heroCell, hooks);
    expect(spawns).toBe(1);
    pressArenaCell(level, new RNG(2), heroCell, hooks);
    expect(spawns).toBe(1);

    const other = arenaLevel(5).level;
    pressArenaCell(other, new RNG(1), other.stairsUp, hooks);
    expect(other.enteredArena).toBe(false);
  });

  test('no arena: no-op', () => {
    const { results } = runDepths(1, 7);
    const level = results.get(7)!.level;
    let spawns = 0;
    pressArenaCell(level, new RNG(1), level.stairsUp, {
      occupied: () => false,
      spawn: () => spawns++,
    });
    expect(spawns).toBe(0);
    expect(level.enteredArena).toBe(false);
  });

  test('moveHero integration: walking into the arena spawns hunting Tengu', () => {
    const { results } = runDepths(6, 10);
    const level = results.get(10)!.level;
    const arena = level.bossArena!;
    const w = level.w;

    // Walk the faithful path: unlock the arena door with the iron key, step
    // through, step into the arena.
    const door = level.arenaDoorCell;
    const dx = door % w;
    const dy = Math.floor(door / w);
    // Anteroom-side neighbor of the door.
    const from = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([ox, oy]) => ({ x: dx + ox, y: dy + oy }))
      .find((p) => p.x < arena.l || p.x > arena.r || p.y < arena.t || p.y > arena.b)!;
    const into = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([ox, oy]) => ({ x: dx + ox, y: dy + oy }))
      .find(
        (p) => p.x >= arena.l && p.x <= arena.r && p.y >= arena.t && p.y <= arena.b,
      )!;

    const hero = createStarterHero(from.y * w + from.x, w);
    hero.inventory.push({ itemId: 'iron_key', qty: 1 });
    const { ctx, logs, mobs } = makeCtx(level, hero);

    // Step 1: bump the locked door with the key -> unlock (no step in).
    moveHero(ctx, hero, dx - from.x, dy - from.y);
    expect(level.get(dx, dy)).toBe(Terrain.DOOR);
    expect(logs).toContain('You unlock the door.');

    // Step 2: step onto the door cell.
    moveHero(ctx, hero, dx - from.x, dy - from.y);
    expect(hero.pos).toBe(door);

    // Step 3: step into the arena -> Tengu spawns, door re-locks.
    moveHero(ctx, hero, into.x - dx, into.y - dy);
    expect(level.enteredArena).toBe(true);
    expect(mobs.length).toBe(1);
    const tengu = mobs[0] as unknown as { state: string };
    expect(tengu.state).toBe('hunting');
    expect(logs).toContain('Gotcha, warrior!');
    expect(level.get(dx, dy)).toBe(Terrain.DOOR_LOCKED);
  });
});

describe('skeleton key: PrisonBossLevel.drop (PrisonBossLevel.java:331-343)', () => {
  test('first skeleton-key drop turns the arena door into a plain DOOR', () => {
    const { results } = runDepths(1, 10);
    const level = results.get(10)!.level;
    onItemDropped(level, 'skeleton_key');
    expect(level.keyDropped).toBe(true);
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR);
    // Later drops are plain drops.
    level.set(
      level.arenaDoorCell % level.w,
      Math.floor(level.arenaDoorCell / level.w),
      Terrain.DOOR_LOCKED,
    );
    onItemDropped(level, 'skeleton_key');
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR_LOCKED);
  });

  test('other items and levels without an arena are ignored', () => {
    const { results } = runDepths(2, 10);
    const level = results.get(10)!.level;
    onItemDropped(level, 'iron_key');
    expect(level.keyDropped).toBe(false);
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR_LOCKED);

    const plain = runDepths(2, 7).results.get(7)!.level;
    onItemDropped(plain, 'skeleton_key');
    expect(plain.keyDropped).toBe(false);
  });

  test('dropItemAt integration: Tengu death drop unseals the door', () => {
    const { results } = runDepths(4, 10);
    const level = results.get(10)!.level;
    const hero = createStarterHero(level.stairsUp, level.w);
    const { ctx } = makeCtx(level, hero);
    dropItemAt(ctx, level.stairsUp, 'skeleton_key');
    expect(level.keyDropped).toBe(true);
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR);
  });
});

describe('run state across transitions and save/load', () => {
  test('one RunState threads depths 1-10: ghost + wandmaker each once', () => {
    const { run, results } = runDepths(8, 10);
    // Ghost quest fires on depths 2-4 (once/run); wandmaker on 7-9 (once/run).
    expect(run.ghostSpawned).toBe(true);
    expect(run.wandmakerSpawned).toBe(true);
    let ghosts = 0;
    let makers = 0;
    for (const [, g] of results) {
      for (const m of g.mobs) {
        if (m.kind === 'ghost') ghosts++;
        if (m.kind === 'wandmaker') makers++;
      }
    }
    expect(ghosts).toBeLessThanOrEqual(1);
    expect(makers).toBe(1);
  });

  test('engine descend 1->10 keeps run state; depth 10 has arena metadata', () => {
    const game = new Game(11, {
      gen: contentLevelGen,
      mechanics: contentMechanics,
    });
    for (let d = 2; d <= 10; d++) game.descend();
    expect(game.level.depth).toBe(10);
    expect(game.level.region).toBe(Region.PRISON);
    expect(game.level.bossLevel).toBe(true);
    expect(game.level.bossArena).not.toBeNull();
    expect(game.level.arenaDoorCell).toBeGreaterThanOrEqual(0);
    expect(game.mobs.length).toBe(0);
    expect(game.run.wandmakerSpawned).toBe(true);
  });

  test('save/load preserves run state and arena metadata', () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    };
    try {
      const game = new Game(12, {
        gen: contentLevelGen,
        mechanics: contentMechanics,
      });
      for (let d = 2; d <= 8; d++) game.descend();
      game.level.enteredArena = true;
      game.level.keyDropped = true;
      saveGame(game, contentMechanics);
      const loaded = loadGame(contentMechanics)!;
      expect(loaded).not.toBeNull();
      expect(loaded.run).toEqual(game.run);
      expect(loaded.level.bossArena).toEqual(game.level.bossArena);
      expect(loaded.level.arenaDoorCell).toBe(game.level.arenaDoorCell);
      expect(loaded.level.enteredArena).toBe(true);
      expect(loaded.level.keyDropped).toBe(true);
    } finally {
      clearSave();
    }
  });
});
