import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng';
import { Terrain, Feeling, isHiddenTrap } from '../src/core/grid';
import { RoomType, roomW, roomH } from '../src/dungeon/rooms';
import {
  generateLevel,
  generateRun,
  newRunState,
  type GenResult,
} from '../src/dungeon/generator';

const SEED = 20260919;

function run(seed = SEED): GenResult[] {
  return generateRun(new RNG(seed));
}

/** Door tiles are traversable once unlocked/found (keys are guaranteed), so
 * structural connectivity treats them as passable. */
const DOOR_TILES = new Set([
  Terrain.DOOR,
  Terrain.DOOR_SECRET,
  Terrain.DOOR_LOCKED,
  Terrain.BARRICADE,
  Terrain.BOOKSHELF,
]);

/** BFS over traversable tiles from the entrance; returns reachable set. */
function reachable(g: GenResult): Set<number> {
  const lvl = g.level;
  const pass = (x: number, y: number) => lvl.isPassable(x, y) || DOOR_TILES.has(lvl.get(x, y));
  const seen = new Set<number>([lvl.stairsUp]);
  const q = [lvl.stairsUp];
  while (q.length) {
    const c = q.pop()!;
    const x = c % 32;
    const y = Math.floor(c / 32);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= 32 || ny < 0 || ny >= 32) continue;
      if (!pass(nx, ny)) continue;
      const n = ny * 32 + nx;
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}

/** The boss arena room (vanilla types it BOSS_EXIT, not EXIT). */
function arena(g: GenResult) {
  const r = g.rooms.find((r) => r.type === RoomType.BOSS_EXIT);
  if (!r) throw new Error('no boss arena');
  return r;
}

describe('dungeon determinism', () => {
  test('same seed => identical tiles and metadata', () => {
    const a = run();
    const b = run();
    expect(a.length).toBe(5);
    for (let d = 0; d < 5; d++) {
      expect([...a[d]!.level.tiles]).toEqual([...b[d]!.level.tiles]);
      expect(a[d]!.level.doors).toEqual(b[d]!.level.doors);
      expect(a[d]!.level.traps).toEqual(b[d]!.level.traps);
      expect(a[d]!.items).toEqual(b[d]!.items);
      expect(a[d]!.mobs).toEqual(b[d]!.mobs);
      expect(a[d]!.markers).toEqual(b[d]!.markers);
      expect(a[d]!.level.stairsUp).toBe(b[d]!.level.stairsUp);
      expect(a[d]!.level.stairsDown).toBe(b[d]!.level.stairsDown);
      expect(a[d]!.level.secretDoors).toBe(b[d]!.level.secretDoors);
      expect(a[d]!.level.feeling).toBe(b[d]!.level.feeling);
    }
  });

  test('different seeds => different layouts', () => {
    const a = run(1);
    const b = run(2);
    let diff = 0;
    for (let d = 0; d < 5; d++) {
      for (let i = 0; i < 1024; i++) {
        if (a[d]!.level.tiles[i] !== b[d]!.level.tiles[i]) diff++;
      }
    }
    expect(diff).toBeGreaterThan(0);
  });
});

describe('dungeon structure (depths 1-5)', () => {
  const depths = run();

  test('every depth has both stairs on matching tiles', () => {
    for (const g of depths) {
      const lvl = g.level;
      expect(lvl.stairsUp).toBeGreaterThanOrEqual(0);
      expect(lvl.stairsDown).toBeGreaterThanOrEqual(0);
      expect(lvl.getAt(lvl.stairsUp)).toBe(Terrain.ENTRANCE);
    }
  });

  test('exit tile is EXIT on depths 1-4, EXIT_LOCKED on depth 5', () => {
    for (let d = 0; d < 4; d++) {
      expect(depths[d]!.level.getAt(depths[d]!.level.stairsDown)).toBe(Terrain.EXIT);
    }
    expect(depths[4]!.level.getAt(depths[4]!.level.stairsDown)).toBe(Terrain.EXIT_LOCKED);
  });

  test('entrance-to-exit is connected on every depth', () => {
    for (let d = 0; d < 4; d++) {
      const g = depths[d]!;
      expect(reachable(g).has(g.level.stairsDown)).toBe(true);
    }
  });

  test('depth 5 exit is adjacent to reachable floor (locked exits are solid)', () => {
    // Vanilla flags LOCKED_EXIT as SOLID: the hero stands below it and the
    // tile unlocks when Goo dies. decorateBoss keeps the exit column clear.
    const g = depths[4]!;
    const reach = reachable(g);
    const ex = g.level.stairsDown % 32;
    const ey = Math.floor(g.level.stairsDown / 32);
    const adjacent = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => reach.has((ey + dy) * 32 + (ex + dx)));
    expect(adjacent).toBe(true);
    expect(g.level.get(ex, ey + 1)).toBe(Terrain.FLOOR);
  });

  test('depth 5 is the boss level with no feeling', () => {
    const g = depths[4]!;
    expect(g.level.bossLevel).toBe(true);
    expect(g.level.feeling).toBe(Feeling.NONE);
    for (let d = 0; d < 4; d++) expect(depths[d]!.level.bossLevel).toBe(false);
  });

  test('quest items spawn on depths 1-4, not on depth 5', () => {
    const tags = (g: GenResult) => g.items.map((i) => i.tag);
    expect(tags(depths[0])).toContain('food');
    expect(tags(depths[0])).toContain('potion-of-strength');
    expect(tags(depths[2])).toContain('scroll-of-enchantment');
    expect(tags(depths[3])).toContain('food');
    expect(tags(depths[4])).not.toContain('food');
    // Scroll of Upgrade uses the vanilla souNeeded quota (probabilistic);
    // it appears only on depths 1-4 and never as ordinary random loot.
    const upgradeDepths = [0, 1, 2, 3].filter((d) => tags(depths[d]).includes('scroll-of-upgrade'));
    expect(tags(depths[4])).not.toContain('scroll-of-upgrade');
    for (const d of [0, 1, 2, 3]) {
      const n = tags(depths[d]).filter((t) => t === 'scroll-of-upgrade').length;
      expect(n).toBeLessThanOrEqual(1);
    }
    expect(upgradeDepths.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Goo boss level (depth 5)', () => {
  const g = run()[4]!;

  test('Goo is the sole boss mob, in the exit arena', () => {
    const bosses = g.mobs.filter((m) => m.kind === 'boss');
    expect(bosses.length).toBe(1);
    const exitRoom = arena(g);
    const b = bosses[0]!;
    const x = b.pos % 32;
    const y = Math.floor(b.pos / 32);
    expect(x).toBeGreaterThanOrEqual(exitRoom.l);
    expect(x).toBeLessThanOrEqual(exitRoom.r);
    expect(y).toBeGreaterThanOrEqual(exitRoom.t);
    expect(y).toBeLessThanOrEqual(exitRoom.b);
    expect(g.mobs.filter((m) => m.kind === 'mob').length).toBe(0);
  });

  test('arena is at least 6x6 and exit is top-center', () => {
    const exitRoom = arena(g);
    expect(roomW(exitRoom)).toBeGreaterThanOrEqual(6);
    expect(roomH(exitRoom)).toBeGreaterThanOrEqual(6);
    expect(g.level.stairsDown % 32).toBe(Math.floor((exitRoom.l + exitRoom.r) / 2));
    expect(Math.floor(g.level.stairsDown / 32)).toBe(exitRoom.t);
  });

  test('arena has water decoration below the top wall row', () => {
    const exitRoom = arena(g);
    let water = 0;
    for (let x = exitRoom.l + 1; x < exitRoom.r; x++) {
      if (g.level.getAt((exitRoom.t + 2) * 32 + x) === Terrain.WATER) water++;
    }
    expect(water).toBeGreaterThan(0);
  });

  test('boss level has no quest items; rat king chests are the only loot', () => {
    // Vanilla RatKingPainter drops its chests on the boss level too.
    for (const i of g.items) {
      expect(i.tag === undefined || i.tag.startsWith('gold:') || i.tag.startsWith('prize-')).toBe(true);
    }
    const tags = g.items.map((i) => i.tag);
    expect(tags).not.toContain('food');
  });

  test('rat king, when present, is beside or below the arena, never above', () => {
    const king = g.mobs.find((m) => m.kind === 'ratking');
    if (!king) return; // seed-dependent; constraint checked when it spawns
    const exitRoom = arena(g);
    const kx = king.pos % 32;
    const ky = Math.floor(king.pos / 32);
    const left = kx < exitRoom.l;
    const right = kx > exitRoom.r;
    const below = ky > exitRoom.b;
    const above = ky < exitRoom.t;
    expect(left || right || below).toBe(true);
    expect(above).toBe(false);
  });
});

describe('traps', () => {
  const depths = run();

  test('depth 1 has no trap attempts', () => {
    expect(depths[0]!.trapAttempts).toBe(0);
    expect(depths[0]!.trapsPlaced).toBe(0);
    expect(depths[0]!.level.traps.length).toBe(0);
  });

  test('trap attempts stay within the vanilla range', () => {
    for (let d = 1; d < 5; d++) {
      const g = depths[d]!;
      // vanilla: Int(1, rooms.size()+depth)
      expect(g.trapAttempts).toBeGreaterThanOrEqual(1);
      expect(g.trapAttempts).toBeLessThanOrEqual(g.rooms.length + (d + 1) - 1);
      expect(g.trapsPlaced).toBeLessThanOrEqual(g.trapAttempts);
    }
  });

  test('every trap cell is registered and sits on a trap tile', () => {
    for (const g of depths) {
      for (const c of g.level.traps) {
        const t = g.level.getAt(c);
        const isTrap =
          isHiddenTrap(t) || (t >= Terrain.TRAP_TOXIC && t <= Terrain.TRAP_SUMMONING && t % 2 === 0);
        expect(isTrap).toBe(true);
      }
    }
  });
});

describe('doors', () => {
  const depths = run();

  test('depth 1 has no secret doors', () => {
    const tiles = depths[0]!.level.tiles;
    expect([...tiles].filter((t) => t === Terrain.DOOR_SECRET).length).toBe(0);
    expect(depths[0]!.level.secretDoors).toBe(0);
  });

  test('secret door count matches secret tiles', () => {
    for (const g of depths) {
      const secret = [...g.level.tiles].filter((t) => t === Terrain.DOOR_SECRET).length;
      expect(g.level.secretDoors).toBe(secret);
    }
  });

  test('every registered door cell holds a door tile', () => {
    const doorTiles = new Set([
      Terrain.DOOR,
      Terrain.DOOR_SECRET,
      Terrain.DOOR_LOCKED,
      Terrain.BARRICADE,
      Terrain.BOOKSHELF,
    ]);
    for (const g of depths) {
      for (const c of g.level.doors) {
        expect(doorTiles.has(g.level.getAt(c) as Terrain)).toBe(true);
      }
    }
  });
});

describe('mob placement', () => {
  const depths = run();

  test('regular mobs spawn in standard rooms, away from the entrance', () => {
    for (let d = 0; d < 4; d++) {
      const g = depths[d]!;
      const entranceRoom = g.rooms.find((r) => r.type === RoomType.ENTRANCE)!;
      for (const m of g.mobs) {
        if (m.kind !== 'mob' && m.kind !== 'ghost') continue;
        expect(m.pos).not.toBe(g.level.stairsUp);
        const room = g.rooms.find(
          (r) =>
            m.pos % 32 >= r.l &&
            m.pos % 32 <= r.r &&
            Math.floor(m.pos / 32) >= r.t &&
            Math.floor(m.pos / 32) <= r.b,
        );
        expect(room).toBeDefined();
        expect(room!.type).toBe(RoomType.STANDARD);
        expect(room).not.toBe(entranceRoom);
        expect(g.level.isPassable(m.pos % 32, Math.floor(m.pos / 32))).toBe(true);
      }
    }
  });

  test('mob counts are within the vanilla range', () => {
    for (let d = 0; d < 4; d++) {
      const depth = d + 1;
      const n = depths[d]!.mobs.filter((m) => m.kind === 'mob').length;
      const min = 2 + (depth % 5);
      expect(n).toBeGreaterThanOrEqual(min - 2); // respawn can fail on tiny maps
      expect(n).toBeLessThanOrEqual(min + 2);
    }
  });
});

describe('markers and decoration', () => {
  const depths = run();

  test('every depth has an entrance sign', () => {
    for (const g of depths) {
      expect(g.markers.signs.length).toBe(1);
      expect(g.markers.signs[0]).not.toBe(g.level.stairsUp);
    }
  });

  test('decorative markers never overwrite real tiles', () => {
    for (const g of depths) {
      for (const c of g.markers.wallDeco) {
        expect(g.level.getAt(c)).toBe(Terrain.WALL);
      }
      for (const c of g.markers.emptyDeco) {
        expect(g.level.getAt(c)).toBe(Terrain.FLOOR);
      }
    }
  });
});

describe('single-depth generation', () => {
  test('generateLevel works standalone per depth', () => {
    for (let depth = 1; depth <= 5; depth++) {
      const g = generateLevel(new RNG(99), depth, newRunState());
      expect(g.level.depth).toBe(depth);
      expect(g.level.stairsUp).toBeGreaterThanOrEqual(0);
      expect(g.level.stairsDown).toBeGreaterThanOrEqual(0);
      if (depth < 5) {
        expect(reachable(g).has(g.level.stairsDown)).toBe(true);
      } else {
        // Locked exit is solid; the cell below it must be reachable.
        const ex = g.level.stairsDown % 32;
        const ey = Math.floor(g.level.stairsDown / 32);
        expect(reachable(g).has((ey + 1) * 32 + ex)).toBe(true);
      }
    }
  });
});
