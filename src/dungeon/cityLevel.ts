/**
 * City chapter (depths 16-20) level generation painters.
 *
 * Ground truth: ~/workspace/pixel-dungeon-src
 * (levels/CityLevel.java, levels/CityBossLevel.java, levels/Terrain.java).
 * Java wins every conflict.
 *
 * - CityLevel (16-19) is a RegularLevel: standard room paint, city water/grass
 *   rates (CityLevel.java:49-55), TUNNEL rooms painted as PASSAGE
 *   (CityLevel.java:57-65), Imp.Quest.spawn from createItems
 *   (CityLevel.java:96-100), deco scatter + entrance-room sign
 *   (CityLevel.java:68-84).
 * - CityBossLevel (20) extends Level directly: fixed hall/arena carve,
 *   pedestals, LOCKED_EXIT, arena DOOR, bookshelf entrance chamber, deco
 *   scatter + sign below the arena door (CityBossLevel.java:58-137). No
 *   feeling, no placeTraps, no pre-spawned mobs, no water/grass.
 */
import { Terrain } from '../core/grid.js';
import { PainterCtx, randomCell } from './painters.js';
import type { Room } from './rooms.js';

/** City regular depths (16-19), where CityLevel rules apply. */
export function isCityDepth(depth: number): boolean {
  return depth >= 16 && depth <= 19;
}

/**
 * CityBossLevel geometry (CityBossLevel.java:36-45). WIDTH is 32 in this
 * port; the Java integer divisions are reproduced with Math.floor so the
 * constants land exactly: LEFT = (32-7)/2 = 12, CENTER = 12 + 7/2 = 15.
 */
const BOSS_W = 32;
export const CITY_BOSS_GEOMETRY = {
  TOP: 2,
  HALL_WIDTH: 7,
  HALL_HEIGHT: 15,
  CHAMBER_HEIGHT: 3,
  get LEFT(): number {
    return Math.floor((BOSS_W - 7) / 2); // 12
  },
  get CENTER(): number {
    return Math.floor((BOSS_W - 7) / 2) + Math.floor(7 / 2); // 15
  },
} as const;

/**
 * CityBossLevel.pedestal (CityBossLevel.java:139-147): the two pedestal
 * cells flanking the carpeted aisle at hall mid-height.
 * left: (TOP + HALL_HEIGHT/2)*WIDTH + CENTER - 2 = 301
 * right: (TOP + HALL_HEIGHT/2)*WIDTH + CENTER + 2 = 305
 */
export function pedestalCell(left: boolean): number {
  const g = CITY_BOSS_GEOMETRY;
  const row = g.TOP + Math.floor(g.HALL_HEIGHT / 2);
  return row * BOSS_W + g.CENTER + (left ? -2 : 2);
}

/** CityBossLevel arena-door cell: (TOP+HALL_HEIGHT)*WIDTH + CENTER = 559. */
export function arenaDoorCell(): number {
  const g = CITY_BOSS_GEOMETRY;
  return (g.TOP + g.HALL_HEIGHT) * BOSS_W + g.CENTER;
}

/** CityBossLevel exit cell: (TOP-1)*WIDTH + CENTER = 47 (LOCKED_EXIT). */
export function bossExitCell(): number {
  const g = CITY_BOSS_GEOMETRY;
  return (g.TOP - 1) * BOSS_W + g.CENTER;
}

/**
 * Vanilla `CityBossLevel.build` + `CityBossLevel.decorate`
 * (CityBossLevel.java:58-137), mirroring this port's `paintCavesBoss` shape.
 *
 * Carve order matters (later paints overwrite earlier ones, exactly as the
 * Java `Painter.fill`/`map[pos] =` sequence does):
 *  1. hall EMPTY rect (LEFT, TOP, 7x15), center aisle EMPTY_SP (WALKWAY)
 *  2. STATUE_SP pairs flanking the aisle every other row from TOP+1
 *  3. two PEDESTALs at mid-hall with EMPTY_SP carpet between
 *  4. LOCKED_EXIT at (TOP-1, CENTER); arena DOOR below the hall
 *  5. bookshelf entrance chamber (3 rows below the door)
 *  6. ENTRANCE at a random chamber cell (may overwrite a bookshelf tile,
 *     exactly as vanilla does — entrance is painted last)
 *  7. decorate: 1-in-10 EMPTY -> EMPTY_DECO, 1-in-8 WALL -> WALL_DECO
 *     (recorded in markers; the shared Terrain contract has no deco ids),
 *     and the SIGN one row below-right of the arena door.
 *
 * Returns entrance/exit/arena-door cells for the generator's runtime seam
 * (level.arenaDoorCell, used by the city boss press/drop hooks).
 */
export function paintCityBoss(ctx: PainterCtx): {
  entrance: number;
  exit: number;
  arenaDoor: number;
} {
  const g = CITY_BOSS_GEOMETRY;
  const W = ctx.width;
  const rng = ctx.rng;

  // CityBossLevel.java:81-82
  ctx.fillRect(g.LEFT, g.TOP, g.HALL_WIDTH, g.HALL_HEIGHT, Terrain.FLOOR);
  ctx.fillRect(g.CENTER, g.TOP, 1, g.HALL_HEIGHT, Terrain.WALKWAY); // EMPTY_SP

  // CityBossLevel.java:84-89 — statue pairs flanking the aisle.
  let y = g.TOP + 1;
  while (y < g.TOP + g.HALL_HEIGHT) {
    // Vanilla uses Terrain.STATUE_SP; the shared Terrain contract has no
    // STATUE_SP id, and its flags are STATUE flags | UNSTITCHABLE
    // (Terrain.java:109-110, rendering-only difference) — store STATUE.
    ctx.set(g.CENTER - 2, y, Terrain.STATUE);
    ctx.set(g.CENTER + 2, y, Terrain.STATUE);
    y += 2;
  }

  // CityBossLevel.java:91-95 — pedestals with carpet between.
  const left = pedestalCell(true);
  const right = pedestalCell(false);
  ctx.tiles[left] = Terrain.PEDESTAL;
  ctx.tiles[right] = Terrain.PEDESTAL;
  for (let i = left + 1; i < right; i++) {
    ctx.tiles[i] = Terrain.WALKWAY; // EMPTY_SP
  }

  // CityBossLevel.java:97-101
  const exit = bossExitCell();
  ctx.tiles[exit] = Terrain.EXIT_LOCKED; // vanilla LOCKED_EXIT

  const door = arenaDoorCell();
  ctx.tiles[door] = Terrain.DOOR;

  // CityBossLevel.java:103-105 — entrance chamber with bookshelf columns.
  const chamberTop = g.TOP + g.HALL_HEIGHT + 1;
  ctx.fillRect(g.LEFT, chamberTop, g.HALL_WIDTH, g.CHAMBER_HEIGHT, Terrain.FLOOR);
  ctx.fillRect(g.LEFT, chamberTop, 1, g.CHAMBER_HEIGHT, Terrain.BOOKSHELF);
  ctx.fillRect(
    g.LEFT + g.HALL_WIDTH - 1,
    chamberTop,
    1,
    g.CHAMBER_HEIGHT,
    Terrain.BOOKSHELF,
  );

  // CityBossLevel.java:107-108 — painted after the bookshelves, so it can
  // land on one: (19 + Int(2)) x (12 + Int(5)).
  const entrance =
    (g.TOP + g.HALL_HEIGHT + 2 + rng.int(0, g.CHAMBER_HEIGHT - 1)) * W +
    g.LEFT +
    rng.int(0, g.HALL_WIDTH - 2);
  ctx.tiles[entrance] = Terrain.ENTRANCE;

  // CityBossLevel.java:111-119 — deco scatter.
  decorateScatter(ctx);

  // CityBossLevel.java:121-124 — sign one row below-right of the arena door.
  ctx.out.markers.signs.push(door + W + 1);

  return { entrance, exit, arenaDoor: door };
}

/**
 * The 1-in-10 EMPTY / 1-in-8 WALL deco scatter shared by CityLevel.decorate
 * (CityLevel.java:68-76) and CityBossLevel.decorate (CityBossLevel.java:111-119).
 * EMPTY_DECO/WALL_DECO have no ids in the shared Terrain contract, so tiles
 * stay FLOOR/WALL and positions are recorded in markers — the same convention
 * as the sewers/prison/caves decorators.
 */
export function decorateScatter(ctx: PainterCtx): void {
  const rng = ctx.rng;
  const n = ctx.tiles.length;
  for (let i = 0; i < n; i++) {
    if (ctx.tiles[i] === Terrain.FLOOR && rng.int(0, 10) === 0) {
      ctx.out.markers.emptyDeco.push(i);
    } else if (ctx.tiles[i] === Terrain.WALL && rng.int(0, 8) === 0) {
      ctx.out.markers.wallDeco.push(i);
    }
  }
}

/**
 * Vanilla `CityLevel.decorate` (CityLevel.java:68-84): the deco scatter plus
 * a SIGN at a random entrance-room cell that is not the entrance tile.
 * (The WALL_DECO smoke emitters in CityLevel.addVisuals are a rendering-layer
 * concern; the renderer owns them.)
 */
export function decorateCity(
  ctx: PainterCtx,
  entranceRoom: Room,
  entranceCell: number,
): void {
  decorateScatter(ctx);
  // CityLevel.java:78-84 — the loop always terminates (rooms have >1 cell).
  for (;;) {
    const pos = randomCell(ctx, entranceRoom);
    if (pos !== entranceCell) {
      ctx.out.markers.signs.push(pos);
      break;
    }
  }
}
