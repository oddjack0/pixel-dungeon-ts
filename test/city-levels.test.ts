/**
 * Stage 3 tests: City depths 16-20 — regular generation (water/grass rates,
 * TUNNEL->PASSAGE, the depth-16 shop, the imp quest, deco scatter + sign) and
 * the Dwarf King boss arena (build geometry, arena-entry spawn, LOCKED_DOOR
 * seal, skeleton-key unseal), plus the extracted city tileset.
 *
 * Ground truth: ~/workspace/pixel-dungeon-src —
 *   levels/CityLevel.java, levels/CityBossLevel.java, levels/Terrain.java,
 *   levels/RegularLevel.java, actors/mobs/npcs/Imp.java.
 * Java wins every conflict; each assertion cites its source.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain, Region } from '../src/core/grid.js';
import {
  generateLevel,
  newRunState,
  shopOnLevel,
  type GenResult,
  type RunState,
} from '../src/dungeon/generator.js';
import { resetSpecials, RoomType, type Room } from '../src/dungeon/rooms.js';
import { PainterCtx } from '../src/dungeon/painters.js';
import { Level } from '../src/dungeon/level.js';
import {
  isCityDepth,
  paintCityBoss,
  decorateCity,
  pedestalCell,
  arenaDoorCell,
  bossExitCell,
  CITY_BOSS_GEOMETRY,
} from '../src/dungeon/cityLevel.js';
import { pressArenaCell, onItemDropped } from '../src/dungeon/cityBoss.js';
import { STAGE3_CITY_SPRITES } from '../src/assets/stage3_city_sprites.js';

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

/** BFS over traversable tiles (same contract as test/dungeon.test.ts). */
function reachable(level: Level, from: number): Set<number> {
  const doors = new Set([
    Terrain.DOOR,
    Terrain.DOOR_SECRET,
    Terrain.DOOR_LOCKED,
    Terrain.OPEN_DOOR,
  ]);
  const seen = new Set<number>([from]);
  const q = [from];
  while (q.length) {
    const c = q.pop()!;
    const x = c % level.w;
    const y = Math.floor(c / level.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
      const n = ny * level.w + nx;
      if (seen.has(n)) continue;
      const t = level.getAt(n);
      if (t === Terrain.WALL || t === Terrain.CHASM) continue;
      if (t === Terrain.EXIT_LOCKED) continue;
      if (doors.has(t) || level.isPassable(nx, ny)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}

describe('city depth predicates', () => {
  test('isCityDepth covers 16-19 only', () => {
    for (let d = 1; d <= 26; d++) {
      expect(isCityDepth(d)).toBe(d >= 16 && d <= 19);
    }
  });
  test('shopOnLevel(16) is true (vanilla Dungeon.shopOnLevel)', () => {
    expect(shopOnLevel(16)).toBe(true);
  });
});

describe('CityBossLevel geometry (CityBossLevel.java:36-45)', () => {
  test('hall constants', () => {
    expect(CITY_BOSS_GEOMETRY.TOP).toBe(2);
    expect(CITY_BOSS_GEOMETRY.HALL_WIDTH).toBe(7);
    expect(CITY_BOSS_GEOMETRY.HALL_HEIGHT).toBe(15);
    expect(CITY_BOSS_GEOMETRY.CHAMBER_HEIGHT).toBe(3);
    // (WIDTH-HALL_WIDTH)/2 and LEFT+HALL_WIDTH/2 with Java integer division.
    expect(CITY_BOSS_GEOMETRY.LEFT).toBe(12);
    expect(CITY_BOSS_GEOMETRY.CENTER).toBe(15);
  });
  test('pedestal(left) (CityBossLevel.java:139-147)', () => {
    // (2 + 15/2)*32 + 15 -/+ 2, with 15/2 = 7 (integer division).
    expect(pedestalCell(true)).toBe(301);
    expect(pedestalCell(false)).toBe(305);
  });
  test('arena door and exit cells', () => {
    // (TOP+HALL_HEIGHT)*WIDTH + CENTER = 559 (CityBossLevel.java:101)
    expect(arenaDoorCell()).toBe(559);
    // (TOP-1)*WIDTH + CENTER = 47 (CityBossLevel.java:97)
    expect(bossExitCell()).toBe(47);
  });
});

describe('paintCityBoss build (CityBossLevel.java:58-110)', () => {
  function built(seed: number) {
    const ctx = new PainterCtx(new RNG(seed), 32, 32, 20, 'none', true, false);
    const out = paintCityBoss(ctx);
    return { ctx, ...out };
  }

  test('hall floor rect with carpeted center aisle (CityBossLevel.java:81-82)', () => {
    const { ctx } = built(7);
    for (let y = 2; y <= 16; y++) {
      for (let x = 12; x <= 18; x++) {
        const t = ctx.get(x, y);
        // Center aisle, plus the carpet strip between the pedestals (row 9).
        if (x === 15 || (y === 9 && x >= 14 && x <= 16)) {
          expect(t).toBe(Terrain.WALKWAY);
        } else if (x === 13 || x === 17) {
          // Pedestals overwrite the statue pair on row 9 (painted later,
          // CityBossLevel.java:84-95).
          if (y === 9) expect(t).toBe(Terrain.PEDESTAL);
          else if (y % 2 === 1) expect(t).toBe(Terrain.STATUE);
          else expect(t).toBe(Terrain.FLOOR);
        } else expect(t).toBe(Terrain.FLOOR);
      }
    }
  });

  test('statue pairs flank the aisle every other row (CityBossLevel.java:84-89)', () => {
    const { ctx } = built(7);
    // Row 9's pair is overwritten by the pedestals (painted later).
    for (const y of [3, 5, 7, 11, 13, 15]) {
      expect(ctx.get(13, y)).toBe(Terrain.STATUE);
      expect(ctx.get(17, y)).toBe(Terrain.STATUE);
    }
  });

  test('pedestals with carpet between (CityBossLevel.java:91-95)', () => {
    const { ctx } = built(7);
    // The pedestals overwrite the statue pair on row 9 (painted later).
    expect(ctx.get(13, 9)).toBe(Terrain.PEDESTAL);
    expect(ctx.get(17, 9)).toBe(Terrain.PEDESTAL);
    expect(ctx.get(15, 9)).toBe(Terrain.WALKWAY);
    expect(ctx.tiles[301]).toBe(Terrain.PEDESTAL);
    expect(ctx.tiles[305]).toBe(Terrain.PEDESTAL);
    expect(ctx.tiles[302]).toBe(Terrain.WALKWAY);
    expect(ctx.tiles[303]).toBe(Terrain.WALKWAY);
    expect(ctx.tiles[304]).toBe(Terrain.WALKWAY);
  });

  test('LOCKED_EXIT at the top, arena DOOR below the hall (CityBossLevel.java:97-101)', () => {
    const { ctx, exit, arenaDoor } = built(7);
    expect(exit).toBe(47);
    expect(ctx.tiles[47]).toBe(Terrain.EXIT_LOCKED);
    expect(arenaDoor).toBe(559);
    expect(ctx.tiles[559]).toBe(Terrain.DOOR);
  });

  test('bookshelf entrance chamber (CityBossLevel.java:103-105)', () => {
    const { ctx, entrance } = built(7);
    for (let y = 18; y <= 20; y++) {
      for (let x = 13; x <= 17; x++) {
        const i = y * 32 + x;
        if (i === entrance) continue; // entrance is painted last, may cover a shelf
        expect(ctx.get(x, y)).toBe(Terrain.FLOOR);
      }
      // Bookshelf columns at x=12 and x=18, unless the entrance overwrote them.
      for (const x of [12, 18]) {
        const i = y * 32 + x;
        if (i === entrance) {
          expect(ctx.get(x, y)).toBe(Terrain.ENTRANCE);
        } else {
          expect(ctx.get(x, y)).toBe(Terrain.BOOKSHELF);
        }
      }
    }
  });

  test('entrance bounds: rows 19-20, cols 12-16 (CityBossLevel.java:107-108)', () => {
    for (const seed of SEEDS) {
      const { ctx, entrance } = built(seed);
      const x = entrance % 32;
      const y = Math.floor(entrance / 32);
      expect(y === 19 || y === 20).toBe(true);
      expect(x >= 12 && x <= 16).toBe(true);
      expect(ctx.tiles[entrance]).toBe(Terrain.ENTRANCE);
    }
  });

  test('sign one row below-right of the arena door (CityBossLevel.java:121-124)', () => {
    const { ctx } = built(7);
    expect(ctx.out.markers.signs).toContain(559 + 32 + 1); // 592
  });

  test('deco scatter only touches FLOOR/WALL cells (CityBossLevel.java:111-119)', () => {
    const { ctx } = built(7);
    for (const i of ctx.out.markers.emptyDeco) expect(ctx.tiles[i]).toBe(Terrain.FLOOR);
    for (const i of ctx.out.markers.wallDeco) expect(ctx.tiles[i]).toBe(Terrain.WALL);
    // The scatter must not have touched the special tiles.
    for (const i of [47, 559, 301, 305]) {
      expect(ctx.out.markers.emptyDeco).not.toContain(i);
      expect(ctx.out.markers.wallDeco).not.toContain(i);
    }
  });
});

describe('depth-20 generation (Dwarf King level)', () => {
  test('no rooms, no traps, no pre-spawned mobs; door seam set', () => {
    for (const seed of SEEDS) {
      const { results } = runDepths(seed, 20);
      const g = results.get(20)!;
      expect(g.rooms).toEqual([]);
      expect(g.level.bossLevel).toBe(true);
      expect(g.level.region).toBe(Region.CITY);
      expect(g.trapsPlaced).toBe(0);
      expect(g.mobs).toEqual([]);
      expect(g.level.arenaDoorCell).toBe(559);
      expect(g.level.getAt(559)).toBe(Terrain.DOOR);
      expect(g.level.getAt(47)).toBe(Terrain.EXIT_LOCKED);
      expect(g.level.enteredArena).toBe(false);
      expect(g.level.keyDropped).toBe(false);
      // Markers carry the sign; the tile itself stays FLOOR (port convention).
      expect(g.markers.signs).toContain(592);
    }
  });

  test('the entrance reaches the arena door', () => {
    for (const seed of SEEDS) {
      const { results } = runDepths(seed, 20);
      const level = results.get(20)!.level;
      expect(reachable(level, level.stairsUp).has(level.arenaDoorCell)).toBe(true);
    }
  });

  test('entrance and exit cells are set', () => {
    for (const seed of SEEDS) {
      const { results } = runDepths(seed, 20);
      const level = results.get(20)!.level;
      expect(level.stairsUp).toBeGreaterThanOrEqual(0);
      expect(level.stairsDown).toBe(47);
      expect(level.getAt(level.stairsUp)).toBe(Terrain.ENTRANCE);
    }
  });
});

describe('King spawn: CityBossLevel.press (CityBossLevel.java:184-214)', () => {
  function kingLevel(seed: number): Level {
    return runDepths(seed, 20).results.get(20)!.level;
  }
  const hooksFor = (spawned: number[]) => ({
    occupied: () => false,
    spawn: (p: number) => spawned.push(p),
  });

  test('stepping outside the entrance room spawns the boss, seals the door', () => {
    const level = kingLevel(1);
    // A hall cell: row < arenaDoor row (17).
    const outsideCell = 10 * 32 + 15;
    const spawned: number[] = [];
    pressArenaCell(level, new RNG(42), outsideCell, hooksFor(spawned));
    expect(level.enteredArena).toBe(true);
    expect(spawned.length).toBe(1);
    // CityBossLevel.java:199-207 — passable, outside the entrance room,
    // non-visible preferred (all cells are unseen at generation time).
    const p = spawned[0]!;
    const px = p % level.w;
    const py = Math.floor(p / level.w);
    expect(py).toBeLessThan(17); // cell/WIDTH < arenaDoor/WIDTH
    expect(level.isPassable(px, py)).toBe(true);
    // CityBossLevel.java:210 — the arena door re-locks.
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR_LOCKED);
  });

  test('stepping on the door row itself does not trigger (17 !< 17)', () => {
    const level = kingLevel(2);
    const spawned: number[] = [];
    pressArenaCell(level, new RNG(3), 559, hooksFor(spawned));
    expect(level.enteredArena).toBe(false);
    expect(spawned.length).toBe(0);
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR);
  });

  test('steps inside the entrance chamber do not trigger', () => {
    const level = kingLevel(2);
    const spawned: number[] = [];
    pressArenaCell(level, new RNG(3), 19 * 32 + 14, hooksFor(spawned));
    expect(level.enteredArena).toBe(false);
    expect(spawned.length).toBe(0);
  });

  test('the spawn fires only once', () => {
    const level = kingLevel(4);
    const spawned: number[] = [];
    const hooks = hooksFor(spawned);
    pressArenaCell(level, new RNG(5), 8 * 32 + 15, hooks);
    pressArenaCell(level, new RNG(6), 8 * 32 + 15, hooks);
    expect(spawned.length).toBe(1);
  });

  test('spawn still fires when every cell is visible (count++ < 20 gating)', () => {
    // CityBossLevel.java:203-206 — visible cells are rejected only for the
    // first 20 visible candidates; afterwards a visible cell is accepted.
    const level = kingLevel(5);
    level.visible.fill(1);
    const spawned: number[] = [];
    pressArenaCell(level, new RNG(7), 8 * 32 + 15, hooksFor(spawned));
    expect(spawned.length).toBe(1);
    expect(level.enteredArena).toBe(true);
  });

  test('no-op on levels without an arena door', () => {
    const { results } = runDepths(1, 16);
    const plain = results.get(16)!.level;
    const spawned: number[] = [];
    pressArenaCell(plain, new RNG(1), plain.stairsUp, hooksFor(spawned));
    expect(spawned.length).toBe(0);
    expect(plain.enteredArena).toBe(false);
  });
});

describe('King unseal: CityBossLevel.drop (CityBossLevel.java:198-212)', () => {
  function sealedLevel(seed: number): Level {
    const level = runDepths(seed, 20).results.get(20)!.level;
    pressArenaCell(level, new RNG(42), 10 * 32 + 15, {
      occupied: () => false,
      spawn: () => {},
    });
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR_LOCKED);
    return level;
  }

  test('first skeleton key drop opens the arena door', () => {
    const level = sealedLevel(1);
    onItemDropped(level, 'skeleton_key');
    expect(level.keyDropped).toBe(true);
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR);
  });

  test('other items do not unseal', () => {
    const level = sealedLevel(2);
    onItemDropped(level, 'iron_key');
    expect(level.keyDropped).toBe(false);
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.DOOR_LOCKED);
  });

  test('later key drops are plain drops', () => {
    const level = sealedLevel(3);
    onItemDropped(level, 'skeleton_key');
    level.set(
      level.arenaDoorCell % level.w,
      Math.floor(level.arenaDoorCell / level.w),
      Terrain.WALL,
    );
    onItemDropped(level, 'skeleton_key');
    expect(level.getAt(level.arenaDoorCell)).toBe(Terrain.WALL);
  });
});

describe('depths 16-19 (CityLevel)', () => {
  function cityDepths(seed: number): Map<number, GenResult> {
    return runDepths(seed, 19).results;
  }

  test('region, TUNNEL->PASSAGE, and the depth-16 shop', () => {
    for (const seed of SEEDS) {
      const results = cityDepths(seed);
      for (const d of [16, 17, 18, 19]) {
        const g = results.get(d)!;
        expect(g.level.region).toBe(Region.CITY);
        expect(g.level.bossLevel).toBe(false);
        // CityLevel.java:57-65 — no TUNNEL rooms survive assignRoomType.
        expect(g.rooms.some((r) => r.type === RoomType.TUNNEL)).toBe(false);
      }
      // Depth 16 is a shop level (Dungeon.shopOnLevel).
      const shops = results
        .get(16)!
        .rooms.filter((r: Room) => r.type === RoomType.SHOP);
      expect(shops.length).toBe(1);
    }
  });

  test('deco scatter + entrance-room sign (CityLevel.java:68-84)', () => {
    for (const seed of SEEDS) {
      const { results } = runDepths(seed, 19);
      for (const d of [16, 17, 18, 19]) {
        const g = results.get(d)!;
        expect(g.markers.signs.length).toBe(1);
        const sign = g.markers.signs[0]!;
        expect(sign).not.toBe(g.level.stairsUp);
        expect(g.level.isPassable(sign % 32, Math.floor(sign / 32))).toBe(true);
        for (const i of g.markers.emptyDeco) {
          expect(g.level.getAt(i)).toBe(Terrain.FLOOR);
        }
        for (const i of g.markers.wallDeco) {
          expect(g.level.getAt(i)).toBe(Terrain.WALL);
        }
      }
    }
  });

  test('water and grass patches appear across seeds (CityLevel.java:49-55)', () => {
    let sawWater = false;
    let sawGrass = false;
    for (const seed of SEEDS) {
      const { results } = runDepths(seed, 19);
      for (const d of [16, 17, 18, 19]) {
        const tiles = results.get(d)!.level.tiles;
        for (let i = 0; i < tiles.length; i++) {
          if (tiles[i] === Terrain.WATER) sawWater = true;
          if (tiles[i] === Terrain.GRASS) sawGrass = true;
        }
      }
    }
    expect(sawWater).toBe(true);
    expect(sawGrass).toBe(true);
  });

  test('imp quest: at most one spawn per run, depths 17-19 only (Imp.java:212-223)', () => {
    for (const seed of SEEDS) {
      const { results } = runDepths(seed, 20);
      const impDepths: number[] = [];
      for (const d of [16, 17, 18, 19, 20]) {
        const imps = results.get(d)!.mobs.filter((m) => m.kind === 'imp');
        if (imps.length) impDepths.push(d);
      }
      expect(impDepths.length).toBeLessThanOrEqual(1);
      for (const d of impDepths) {
        expect(d).toBeGreaterThan(16);
        expect(d).toBeLessThan(20);
      }
    }
  });

  test('imp quest: depth 19 guarantees the spawn when not yet spawned', () => {
    // Imp.java:213 — Random.Int(20-19) == Random.Int(1) == 0, always true.
    for (const seed of SEEDS) {
      const rng = new RNG(seed);
      resetSpecials(rng);
      const run = newRunState();
      for (let d = 16; d <= 18; d++) generateLevel(rng, d, run);
      run.impSpawned = false; // force the pre-19 state
      const g19 = generateLevel(rng, 19, run);
      expect(g19.mobs.some((m) => m.kind === 'imp')).toBe(true);
      expect(run.impSpawned).toBe(true);
    }
  });

  test('decorateCity sign avoids the entrance tile (CityLevel.java:78-84)', () => {
    // The while(true) loop must terminate with a non-entrance cell even in a
    // tiny room: drive it directly through decorateCity on depth-16 rooms.
    for (const seed of SEEDS) {
      const { results } = runDepths(seed, 16);
      const g = results.get(16)!;
      const ctx = new PainterCtx(new RNG(seed), 32, 32, 16, 'none', false, false);
      const room = g.rooms.find((r) => r.type === RoomType.ENTRANCE)!;
      const entranceCell = g.level.stairsUp;
      decorateCity(ctx, room, entranceCell);
      expect(ctx.out.markers.signs.length).toBe(1);
      expect(ctx.out.markers.signs[0]).not.toBe(entranceCell);
    }
  });
});

describe('city ambient colors (CityLevel.java:34-35, CityBossLevel.java:40-41)', () => {
  test('depths 16-20 carry the city color1/color2', () => {
    for (const seed of SEEDS) {
      const run = newRunState();
      resetSpecials(new RNG(seed));
      const rng = new RNG(seed);
      for (let d = 16; d <= 20; d++) {
        const g = generateLevel(rng, d, run);
        expect(g.level.color1).toBe(0x4b6636);
        expect(g.level.color2).toBe(0xf2f2f2);
      }
    }
  });
});

describe('city tileset sprites (tiles3.png / water3.png)', () => {
  const EXPECTED_KEYS = [
    'tile_city_chasm',
    'tile_city_floor',
    'tile_city_grass',
    'tile_city_empty_sp',
    'tile_city_wall',
    'tile_city_door',
    'tile_city_entrance',
    'tile_city_exit',
    'tile_city_embers',
    'tile_city_door_locked',
    'tile_city_pedestal',
    'tile_city_wall_deco',
    'tile_city_high_grass',
    'tile_city_door_secret',
    'tile_city_trap_toxic',
    'tile_city_trap_toxic_secret',
    'tile_city_trap_fire',
    'tile_city_trap_fire_secret',
    'tile_city_trap_paralytic',
    'tile_city_trap_paralytic_secret',
    'tile_city_trap_inactive',
    'tile_city_floor_deco',
    'tile_city_locked_exit',
    'tile_city_trap_poison',
    'tile_city_trap_poison_secret',
    'tile_city_sign',
    'tile_city_trap_alarm',
    'tile_city_trap_alarm_secret',
    'tile_city_trap_lightning',
    'tile_city_trap_lightning_secret',
    'tile_city_well',
    'tile_city_statue',
    'tile_city_statue_sp',
    'tile_city_trap_gripping',
    'tile_city_trap_gripping_secret',
    'tile_city_trap_summoning',
    'tile_city_trap_summoning_secret',
    'tile_city_bookshelf',
    'tile_city_alchemy',
    'tile_city_water',
  ];

  test('all 40 city tiles present, 16x16 RGBA', () => {
    expect(Object.keys(STAGE3_CITY_SPRITES).sort()).toEqual([...EXPECTED_KEYS].sort());
    for (const key of EXPECTED_KEYS) {
      const s = STAGE3_CITY_SPRITES[key]!;
      expect(s.w).toBe(16);
      expect(s.h).toBe(16);
      const bytes = Buffer.from(s.rgba, 'base64');
      expect(bytes.length).toBe(16 * 16 * 4);
    }
  });

  test('no key collides with the existing sprite catalog', async () => {
    const { ORIGINAL_SPRITES } = await import('../src/assets/original_sprites.js');
    for (const key of EXPECTED_KEYS) {
      expect(key in ORIGINAL_SPRITES).toBe(false);
    }
  });
});
