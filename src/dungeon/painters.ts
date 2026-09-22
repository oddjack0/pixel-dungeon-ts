import { Terrain } from '../core/grid.js';
import type { RNG } from '../core/rng.js';
import {
  RoomType,
  DoorType,
  roomW,
  roomH,
  upgradeDoor,
  entranceDoor,
  placeDoor,
  joinRooms,
  type Room,
  type Door,
} from './rooms.js';
import type { ItemSpawn, MobSpawn, HeapKind } from './level.js';
import { paintShopRoom } from './shopPainter.js';

/**
 * Room painters + level decoration, faithful to vanilla
 * `levels/painters/*`, `levels/RegularLevel.java` (paint/paintWater/
 * paintGrass/paintDoors/placeTraps), `levels/SewerLevel.java`, and
 * `levels/SewerBossLevel.java`.
 *
 * Terrain-contract gaps (the shared `Terrain` enum has no EMPTY_DECO,
 * WALL_DECO, SIGN, or EMPTY_WELL): those cells are stored as the nearest
 * contract tile (FLOOR/WALL) and their positions are recorded in
 * `PainterOut.markers` so the renderer can draw them distinctly.
 * See docs/DUNGEON-REPORT.md.
 */

/** Vanilla placeTraps switch order: index -> trap. */
export const TRAP_ORDER = [
  'toxic',
  'fire',
  'paralytic',
  'poison',
  'alarm',
  'lightning',
  'gripping',
  'summoning',
] as const;

/** `addItemToSpawn` queue entries (vanilla `Level.itemsToSpawn`). */
/** A queued item spawn: vanilla `Level.itemsToSpawn`. Painters may take from
 * the queue as room prizes; leftovers are dropped on the floor by the
 * generator. `tag` carries the vanilla intent (e.g. 'iron-key',
 * 'quest-scroll-of-upgrade', 'dew-vial') for the content designer. */
export interface SpawnKind {
  tag: string;
  heap: HeapKind;
}

export interface PainterMarkers {
  alchemy: number[];
  wells: { cell: number; kind: 'awareness' | 'health' | 'transmutation' }[];
  signs: number[];
  /** WALL_DECO cells (stored as WALL). */
  wallDeco: number[];
  /** EMPTY_DECO cells (stored as FLOOR). */
  emptyDeco: number[];
  /** EMPTY_WELL cells (stored as FLOOR). */
  dryWells: number[];
}

export interface PainterOut {
  doors: { x: number; y: number; type: DoorType; tile: Terrain }[];
  traps: { x: number; y: number; trap: number; hidden: boolean }[];
  items: ItemSpawn[];
  mobs: MobSpawn[];
  spawnQueue: SpawnKind[];
  markers: PainterMarkers;
}

export function emptyOut(): PainterOut {
  return {
    doors: [],
    traps: [],
    items: [],
    mobs: [],
    spawnQueue: [],
    markers: { alchemy: [], wells: [], signs: [], wallDeco: [], emptyDeco: [], dryWells: [] },
  };
}

/**
 * Painting context: the tile map under construction plus the seeded RNG
 * and everything painters emit besides tiles.
 */
export class PainterCtx {
  readonly tiles: Uint8Array;
  readonly out: PainterOut;
  /** Cells holding a dropped item heap (painters avoid stacking). */
  readonly heaps = new Set<number>();
  constructor(
    public rng: RNG,
    public width: number,
    public height: number,
    public depth: number,
    public feeling: 'none' | 'water' | 'grass' | 'chasm',
    public bossLevel: boolean,
    public bossNext: boolean,
  ) {
    this.tiles = new Uint8Array(width * height).fill(Terrain.WALL);
    this.out = emptyOut();
  }
  idx(x: number, y: number): number {
    return y * this.width + x;
  }
  x(i: number): number {
    return i % this.width;
  }
  y(i: number): number {
    return Math.floor(i / this.width);
  }
  /** Vanilla `Painter.set`: no-op when out of bounds. */
  set(x: number, y: number, t: Terrain): void {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
      this.tiles[y * this.width + x] = t;
    }
  }
  get(x: number, y: number): Terrain {
    return this.tiles[y * this.width + x]!;
  }
  fillRect(x: number, y: number, w: number, h: number, t: Terrain): void {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        this.set(i, j, t);
      }
    }
  }
  /** Vanilla `Painter.fill(level, room, value)` — inclusive bounds. */
  fillRoom(r: Room, t: Terrain): void {
    this.fillRect(r.l, r.t, r.r - r.l + 1, r.b - r.t + 1, t);
  }
  /** Vanilla `Painter.fill(level, room, m, value)`. */
  fillRoomMargin(r: Room, m: number, t: Terrain): void {
    this.fillRect(r.l + m, r.t + m, r.r - r.l + 1 - m * 2, r.b - r.t + 1 - m * 2, t);
  }
  /** All connected doors upgraded monotonically (vanilla `Door.set`). */
  paintDoorsRegular(r: Room): void {
    for (const d of r.doors) upgradeDoor(d, DoorType.REGULAR);
  }
  /** Drop a queued-style spawn as an ItemSpawn for the content designer. */
  drop(pos: number, spawn: SpawnKind, heap: HeapKind = spawn.heap): void {
    this.out.items.push({ pos, heap, tag: spawn.tag });
    this.heaps.add(pos);
  }
}

/** Vanilla `Room.random(m)` as a cell index. */
export function randomCell(ctx: PainterCtx, room: Room, margin = 0): number {
  return ctx.idx(
    ctx.rng.int(room.l + 1 + margin, room.r - margin),
    ctx.rng.int(room.t + 1 + margin, room.b - margin),
  );
}

export function roomCenterCell(ctx: PainterCtx, r: Room): { x: number; y: number } {
  return {
    x: Math.floor((r.l + r.r) / 2) + (roomW(r) % 2 === 1 ? ctx.rng.int(0, 2) : 0),
    y: Math.floor((r.t + r.b) / 2) + (roomH(r) % 2 === 1 ? ctx.rng.int(0, 2) : 0),
  };
}

/**
 * Vanilla `Painter.drawInside`: from a wall point, paint n cells inward.
 * Returns the first cell *past* the painted run.
 */
export function drawInside(
  ctx: PainterCtx,
  room: Room,
  from: { x: number; y: number },
  n: number,
  t: Terrain,
): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  if (from.x === room.l) sx = 1;
  else if (from.x === room.r) sx = -1;
  else if (from.y === room.t) sy = 1;
  else if (from.y === room.b) sy = -1;
  let x = from.x + sx;
  let y = from.y + sy;
  for (let i = 0; i < n; i++) {
    ctx.set(x, y, t);
    x += sx;
    y += sy;
  }
  return { x, y };
}

/**
 * Vanilla `Level.itemToSpanAsPrize` (note the source typo): with
 * probability n/(n+1) pull a random queued item, else null.
 */
export function dropLoot(ctx: PainterCtx, pos: number): void {
  const s = ctx.out.spawnQueue.shift();
  if (s) ctx.drop(pos, s);
}

/**
 * Vanilla-faithful: guaranteed quest items (food, potion of strength, scrolls
 * of upgrade, dew vial — Level.create's itemsToSpawn) are NEVER consumed as
 * special-room prizes. In vanilla they drop in the regular level and special
 * rooms roll their own loot (e.g. LibraryPainter places random scrolls).
 * Consuming them here stranded quest items in locked special rooms, so this
 * always returns null and painters fall back to their generic prizes.
 */
export function takeSpawnAsPrize(ctx: PainterCtx): SpawnKind | null {
  void ctx;
  return null;
}

function isPotionKind(k: SpawnKind): boolean {
  return (
    k.tag === 'levitation' ||
    k.tag === 'invisibility' ||
    k.tag === 'liquid-flame' ||
    k.tag === 'potion-of-strength' ||
    k.tag === 'dew-vial'
  );
}

function isScrollKind(k: SpawnKind): boolean {
  return k.tag === 'scroll-of-upgrade' || k.tag === 'scroll-of-enchantment';
}

// --------------------------------------------------------------- base painters

function paintGraveyard(ctx: PainterCtx, room: Room): void {
  const w = roomW(room);
  const h = roomH(room);
  ctx.fillRect(room.l + 1, room.t + 1, w - 1, h - 1, Terrain.GRASS);
  const nGraves = Math.floor(Math.max(w, h) / 2);
  const index = ctx.rng.int(0, nGraves);
  const shift = ctx.rng.int(0, 2);
  for (let i = 0; i < nGraves; i++) {
    const pos =
      w > h
        ? ctx.idx(room.l + 1 + shift + i * 2, room.t + 2 + ctx.rng.int(0, h - 2))
        : ctx.idx(room.l + 2 + ctx.rng.int(0, w - 2), room.t + 1 + shift + i * 2);
    ctx.drop(pos, prize(i === index ? 'random' : `gold:${ctx.rng.intRange(1, 3)}`), 'TOMB');
  }
}

function paintBurned(ctx: PainterCtx, room: Room): void {
  for (let i = room.t + 1; i < room.b; i++) {
    for (let j = room.l + 1; j < room.r; j++) {
      let t = Terrain.EMBERS;
      switch (ctx.rng.int(0, 5)) {
        case 0:
          t = Terrain.FLOOR;
          break;
        case 1:
          t = Terrain.TRAP_FIRE;
          break;
        case 2:
          t = Terrain.TRAP_FIRE_HIDDEN;
          break;
        case 3:
          t = Terrain.TRAP_INACTIVE;
          break;
      }
      ctx.set(j, i, t);
      if (t === Terrain.TRAP_FIRE) {
        ctx.out.traps.push({ x: j, y: i, trap: 1, hidden: false });
      } else if (t === Terrain.TRAP_FIRE_HIDDEN) {
        ctx.out.traps.push({ x: j, y: i, trap: 1, hidden: true });
      }
    }
  }
}

function paintStriped(ctx: PainterCtx, room: Room): void {
  const w = roomW(room);
  const h = roomH(room);
  ctx.fillRect(room.l + 1, room.t + 1, w - 1, h - 1, Terrain.WALKWAY);
  if (w > h) {
    for (let i = room.l + 2; i < room.r; i += 2) {
      ctx.fillRect(i, room.t + 1, 1, h - 1, Terrain.HIGH_GRASS);
    }
  } else {
    for (let i = room.t + 2; i < room.b; i += 2) {
      ctx.fillRect(room.l + 1, i, w - 1, 1, Terrain.HIGH_GRASS);
    }
  }
}

function paintStudy(ctx: PainterCtx, room: Room): void {
  const w = roomW(room);
  const h = roomH(room);
  ctx.fillRect(room.l + 1, room.t + 1, w - 1, h - 1, Terrain.BOOKSHELF);
  ctx.fillRect(room.l + 2, room.t + 2, w - 3, h - 3, Terrain.WALKWAY);
  for (const door of room.doors) {
    if (door.x === room.l) ctx.set(door.x + 1, door.y, Terrain.FLOOR);
    else if (door.x === room.r) ctx.set(door.x - 1, door.y, Terrain.FLOOR);
    else if (door.y === room.t) ctx.set(door.x, door.y + 1, Terrain.FLOOR);
    else if (door.y === room.b) ctx.set(door.x, door.y - 1, Terrain.FLOOR);
  }
  const c = roomCenterCell(ctx, room);
  ctx.set(c.x, c.y, Terrain.PEDESTAL);
}

function paintBridge(ctx: PainterCtx, room: Room): void {
  const w = roomW(room);
  const h = roomH(room);
  const fill =
    !ctx.bossLevel && !ctx.bossNext && ctx.rng.int(0, 3) === 0 ? Terrain.CHASM : Terrain.WATER;
  ctx.fillRect(room.l + 1, room.t + 1, w - 1, h - 1, fill);
  // Vanilla takes the first two of connected.values() (HashMap order);
  // carve order is this port's deterministic stand-in (see report).
  const door1 = room.doors[0];
  const door2 = room.doors[1];
  if (!door1 || !door2) return;
  const c = roomCenterCell(ctx, room);
  if (
    (door1.x === room.l && door2.x === room.r) ||
    (door1.x === room.r && door2.x === room.l)
  ) {
    const s = Math.floor(w / 2);
    drawInside(ctx, room, door1, s, Terrain.WALKWAY);
    drawInside(ctx, room, door2, s, Terrain.WALKWAY);
    ctx.fillRect(c.x, Math.min(door1.y, door2.y), 1, Math.abs(door1.y - door2.y) + 1, Terrain.WALKWAY);
  } else if (
    (door1.y === room.t && door2.y === room.b) ||
    (door1.y === room.b && door2.y === room.t)
  ) {
    const s = Math.floor(h / 2);
    drawInside(ctx, room, door1, s, Terrain.WALKWAY);
    drawInside(ctx, room, door2, s, Terrain.WALKWAY);
    ctx.fillRect(Math.min(door1.x, door2.x), c.y, Math.abs(door1.x - door2.x) + 1, 1, Terrain.WALKWAY);
  } else if (door1.x === door2.x) {
    ctx.fillRect(
      door1.x === room.l ? room.l + 1 : room.r - 1,
      Math.min(door1.y, door2.y),
      1,
      Math.abs(door1.y - door2.y) + 1,
      Terrain.WALKWAY,
    );
  } else if (door1.y === door2.y) {
    ctx.fillRect(
      Math.min(door1.x, door2.x),
      door1.y === room.t ? room.t + 1 : room.b - 1,
      Math.abs(door1.x - door2.x) + 1,
      1,
      Terrain.WALKWAY,
    );
  } else if (door1.y === room.t || door1.y === room.b) {
    drawInside(ctx, room, door1, Math.abs(door1.y - door2.y), Terrain.WALKWAY);
    drawInside(ctx, room, door2, Math.abs(door1.x - door2.x), Terrain.WALKWAY);
  } else if (door1.x === room.l || door1.x === room.r) {
    drawInside(ctx, room, door1, Math.abs(door1.x - door2.x), Terrain.WALKWAY);
    drawInside(ctx, room, door2, Math.abs(door1.y - door2.y), Terrain.WALKWAY);
  }
}

function paintFissure(ctx: PainterCtx, room: Room): void {
  const w = roomW(room);
  const h = roomH(room);
  ctx.fillRect(room.l + 1, room.t + 1, w - 1, h - 1, Terrain.FLOOR);
  for (let i = room.t + 2; i < room.b - 1; i++) {
    for (let j = room.l + 2; j < room.r - 1; j++) {
      const v = Math.min(i - room.t, room.b - i);
      const hh = Math.min(j - room.l, room.r - j);
      if (Math.min(v, hh) > 2 || ctx.rng.int(0, 2) === 0) {
        ctx.set(j, i, Terrain.CHASM);
      }
    }
  }
}

/** Vanilla `StandardPainter` (sewers have no custom standard painter). */
function paintStandard(ctx: PainterCtx, room: Room): void {
  const w = roomW(room);
  const h = roomH(room);
  ctx.fillRoom(room, Terrain.WALL);
  ctx.paintDoorsRegular(room);
  if (!ctx.bossLevel && ctx.rng.int(0, 5) === 0) {
    switch (ctx.rng.int(0, 6)) {
      case 0:
        if (ctx.feeling !== 'grass') {
          if (Math.min(w, h) >= 4 && Math.max(w, h) >= 6) {
            paintGraveyard(ctx, room);
            return;
          }
          break;
        }
        // Vanilla comment "Burned room": with GRASS feeling, case 0 falls
        // through to case 1 (Java switch fall-through).
        // falls through
      case 1:
        if (ctx.depth > 1) {
          paintBurned(ctx, room);
          return;
        }
        break;
      case 2:
        if (Math.max(w, h) >= 4) {
          paintStriped(ctx, room);
          return;
        }
        break;
      case 3:
        if (w >= 6 && h >= 6) {
          paintStudy(ctx, room);
          return;
        }
        break;
      case 4:
        if (ctx.feeling !== 'water') {
          if (room.doors.length === 2 && w >= 4 && h >= 4) {
            paintBridge(ctx, room);
            return;
          }
          break;
        }
        // Vanilla comment "Fissure": with WATER feeling, case 4 falls
        // through to case 5 (Java switch fall-through).
        // falls through
      case 5:
        if (!ctx.bossLevel && !ctx.bossNext && Math.min(w, h) >= 5) {
          paintFissure(ctx, room);
          return;
        }
        break;
    }
  }
  ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
}

/** Vanilla `TunnelPainter`: L-shaped corridor from each door to the center. */
function paintTunnel(ctx: PainterCtx, room: Room): void {
  const w = roomW(room);
  const h = roomH(room);
  const floor = ctx.feeling === 'chasm' ? Terrain.WALKWAY : Terrain.FLOOR;
  const c = roomCenterCell(ctx, room);
  if (w > h || (w === h && ctx.rng.int(0, 2) === 0)) {
    let from = room.r - 1;
    let to = room.l + 1;
    for (const door of room.doors) {
      const step = door.y < c.y ? 1 : -1;
      if (door.x === room.l) {
        from = room.l + 1;
        for (let i = door.y; i !== c.y; i += step) ctx.set(from, i, floor);
      } else if (door.x === room.r) {
        to = room.r - 1;
        for (let i = door.y; i !== c.y; i += step) ctx.set(to, i, floor);
      } else {
        if (door.x < from) from = door.x;
        if (door.x > to) to = door.x;
        for (let i = door.y + step; i !== c.y; i += step) ctx.set(door.x, i, floor);
      }
    }
    for (let i = from; i <= to; i++) ctx.set(i, c.y, floor);
  } else {
    let from = room.b - 1;
    let to = room.t + 1;
    for (const door of room.doors) {
      const step = door.x < c.x ? 1 : -1;
      if (door.y === room.t) {
        from = room.t + 1;
        for (let i = door.x; i !== c.x; i += step) ctx.set(i, from, floor);
      } else if (door.y === room.b) {
        to = room.b - 1;
        for (let i = door.x; i !== c.x; i += step) ctx.set(i, to, floor);
      } else {
        if (door.y < from) from = door.y;
        if (door.y > to) to = door.y;
        for (let i = door.x + step; i !== c.x; i += step) ctx.set(i, door.y, floor);
      }
    }
    for (let i = from; i <= to; i++) ctx.set(c.x, i, floor);
  }
  for (const door of room.doors) upgradeDoor(door, DoorType.TUNNEL);
}

/**
 * Vanilla `PassagePainter` (levels/painters/PassagePainter.java): walks the
 * room's inner wall ring between its doors, painting the longest-door-gap
 * arc as floor — winding corridors instead of the sewers' L-shaped tunnels.
 */
function paintPassage(ctx: PainterCtx, room: Room): void {
  const pasWidth = roomW(room) - 2;
  const pasHeight = roomH(room) - 2;
  const floor = ctx.feeling === 'chasm' ? Terrain.WALKWAY : Terrain.FLOOR;

  // PassagePainter.java:57-78 — xy2p: wall-ring cell -> perimeter index.
  const xy2p = (x: number, y: number): number => {
    if (y === room.t) {
      return x - room.l - 1;
    } else if (x === room.r) {
      return y - room.t - 1 + pasWidth;
    } else if (y === room.b) {
      return room.r - x - 1 + pasWidth + pasHeight;
    } else {
      // x === room.l
      if (y === room.t + 1) {
        return 0;
      }
      return room.b - y - 1 + pasWidth * 2 + pasHeight;
    }
  };

  // PassagePainter.java:80-97 — p2xy: perimeter index -> wall-ring cell.
  const p2xy = (p: number): { x: number; y: number } => {
    if (p < pasWidth) {
      return { x: room.l + 1 + p, y: room.t + 1 };
    } else if (p < pasWidth + pasHeight) {
      return { x: room.r - 1, y: room.t + 1 + (p - pasWidth) };
    } else if (p < pasWidth * 2 + pasHeight) {
      return { x: room.r - 1 - (p - (pasWidth + pasHeight)), y: room.b - 1 };
    } else {
      return { x: room.l + 1, y: room.b - 1 - (p - (pasWidth * 2 + pasHeight)) };
    }
  };

  const joints: number[] = [];
  for (const door of room.doors) joints.push(xy2p(door.x, door.y));
  joints.sort((a, b) => a - b);

  const nJoints = joints.length;
  const perimeter = pasWidth * 2 + pasHeight * 2;

  if (nJoints === 0) {
    // Degenerate (vanilla would crash): no doors, paint a plain ring.
    ctx.fillRoomMargin(room, 1, floor);
    return;
  }

  // PassagePainter.java:36-46 — start after the widest door gap.
  let start = 0;
  let maxD = joints[0]! + perimeter - joints[nJoints - 1]!;
  for (let i = 1; i < nJoints; i++) {
    const d = joints[i]! - joints[i - 1]!;
    if (d > maxD) {
      maxD = d;
      start = i;
    }
  }

  const end = (start + nJoints - 1) % nJoints;
  let p = joints[start]!;
  do {
    const c = p2xy(p);
    ctx.set(c.x, c.y, floor);
    p = (p + 1) % perimeter;
  } while (p !== joints[end]);
  const c = p2xy(p);
  ctx.set(c.x, c.y, floor);

  for (const door of room.doors) upgradeDoor(door, DoorType.TUNNEL);
}

/** Vanilla `EntrancePainter`: stairs at a random margin-1 cell. */
export function paintEntrance(ctx: PainterCtx, room: Room): number {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
  ctx.paintDoorsRegular(room);
  const entrance = randomCell(ctx, room, 1);
  ctx.tiles[entrance] = Terrain.ENTRANCE;
  return entrance;
}

/** Vanilla `ExitPainter`. */
export function paintExit(ctx: PainterCtx, room: Room): number {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
  ctx.paintDoorsRegular(room);
  const exit = randomCell(ctx, room, 1);
  ctx.tiles[exit] = Terrain.EXIT;
  return exit;
}

/**
 * Vanilla `BossExitPainter`: exit on the TOP WALL at the horizontal center.
 * `SewerBossLevel.decorate` later turns the rest of the top interior row
 * into WALL_DECO + WATER below (see decorateBoss).
 */
export function paintBossExit(ctx: PainterCtx, room: Room): number {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
  ctx.paintDoorsRegular(room);
  const exit = room.t * ctx.width + Math.floor((room.l + room.r) / 2);
  ctx.tiles[exit] = Terrain.EXIT_LOCKED;
  return exit;
}

// ------------------------------------------------------- special-room painters

/** A prize spawn: queued-item intent tagged for the content designer. */
const prize = (tag: string): SpawnKind => ({ tag, heap: 'HEAP' });

/** Vanilla `ArmoryPainter.prize`: 1/6 bomb, else armor/weapon. */
function armoryPrize(ctx: PainterCtx): SpawnKind {
  if (ctx.rng.int(0, 6) === 0) return prize('prize-bomb');
  return prize(ctx.rng.pick(['prize-armor', 'prize-weapon'] as const));
}

function genericPrize(ctx: PainterCtx, categories: string[]): SpawnKind {
  const p = takeSpawnAsPrize(ctx);
  if (p) return p;
  return prize(ctx.rng.pick(categories));
}

function labPrize(ctx: PainterCtx): SpawnKind {
  const p = takeSpawnAsPrize(ctx);
  if (p && isPotionKind(p)) return p;
  if (p) ctx.out.spawnQueue.push(p);
  return prize('prize-potion');
}

function libraryPrize(ctx: PainterCtx): SpawnKind {
  const p = takeSpawnAsPrize(ctx);
  if (p && isScrollKind(p)) return p;
  if (p) ctx.out.spawnQueue.push(p);
  return prize('prize-scroll');
}

/** Far corner opposite the entrance door (vanilla armory/lab/pit pattern). */
function farCorner(ctx: PainterCtx, room: Room, door: Door): { x: number; y: number } {
  if (door.x === room.l) {
    return { x: room.r - 1, y: ctx.rng.int(0, 2) === 0 ? room.t + 1 : room.b - 1 };
  } else if (door.x === room.r) {
    return { x: room.l + 1, y: ctx.rng.int(0, 2) === 0 ? room.t + 1 : room.b - 1 };
  } else if (door.y === room.t) {
    return { x: ctx.rng.int(0, 2) === 0 ? room.l + 1 : room.r - 1, y: room.b - 1 };
  }
  return { x: ctx.rng.int(0, 2) === 0 ? room.l + 1 : room.r - 1, y: room.t + 1 };
}

function paintArmory(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
  const entrance = entranceDoor(room);
  if (entrance) {
    const s = farCorner(ctx, room, entrance);
    ctx.set(s.x, s.y, Terrain.STATUE);
  }
  const n = 3 + (ctx.rng.int(0, 4) === 0 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while ((ctx.tiles[pos] !== Terrain.FLOOR || ctx.heaps.has(pos)) && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    ctx.drop(pos, armoryPrize(ctx));
  }
  if (entrance) upgradeDoor(entrance, DoorType.LOCKED);
  ctx.out.spawnQueue.push(prize('iron-key'));
}

function paintCrypt(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
  const c = roomCenterCell(ctx, room);
  let cx = c.x;
  let cy = c.y;
  const entrance = entranceDoor(room);
  if (entrance) {
    upgradeDoor(entrance, DoorType.LOCKED);
    ctx.out.spawnQueue.push(prize('iron-key'));
    if (entrance.x === room.l) {
      ctx.set(room.r - 1, room.t + 1, Terrain.STATUE);
      ctx.set(room.r - 1, room.b - 1, Terrain.STATUE);
      cx = room.r - 2;
    } else if (entrance.x === room.r) {
      ctx.set(room.l + 1, room.t + 1, Terrain.STATUE);
      ctx.set(room.l + 1, room.b - 1, Terrain.STATUE);
      cx = room.l + 2;
    } else if (entrance.y === room.t) {
      ctx.set(room.l + 1, room.b - 1, Terrain.STATUE);
      ctx.set(room.r - 1, room.b - 1, Terrain.STATUE);
      cy = room.b - 2;
    } else if (entrance.y === room.b) {
      ctx.set(room.l + 1, room.t + 1, Terrain.STATUE);
      ctx.set(room.r - 1, room.t + 1, Terrain.STATUE);
      cy = room.t + 2;
    }
  }
  ctx.drop(ctx.idx(cx, cy), prize('prize-armor'), 'TOMB');
}

function paintLibrary(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
  const entrance = entranceDoor(room);
  let a: { x: number; y: number } | null = null;
  let b: { x: number; y: number } | null = null;
  if (entrance) {
    const h = roomH(room);
    const w = roomW(room);
    if (entrance.x === room.l) {
      a = { x: room.l + 1, y: entrance.y - 1 };
      b = { x: room.l + 1, y: entrance.y + 1 };
      ctx.fillRect(room.r - 1, room.t + 1, 1, h - 1, Terrain.BOOKSHELF);
    } else if (entrance.x === room.r) {
      a = { x: room.r - 1, y: entrance.y - 1 };
      b = { x: room.r - 1, y: entrance.y + 1 };
      ctx.fillRect(room.l + 1, room.t + 1, 1, h - 1, Terrain.BOOKSHELF);
    } else if (entrance.y === room.t) {
      a = { x: entrance.x + 1, y: room.t + 1 };
      b = { x: entrance.x - 1, y: room.t + 1 };
      ctx.fillRect(room.l + 1, room.b - 1, w - 1, 1, Terrain.BOOKSHELF);
    } else if (entrance.y === room.b) {
      a = { x: entrance.x + 1, y: room.b - 1 };
      b = { x: entrance.x - 1, y: room.b - 1 };
      ctx.fillRect(room.l + 1, room.t + 1, w - 1, 1, Terrain.BOOKSHELF);
    }
  }
  if (a && ctx.tiles[ctx.idx(a.x, a.y)] === Terrain.FLOOR) ctx.set(a.x, a.y, Terrain.STATUE);
  if (b && ctx.tiles[ctx.idx(b.x, b.y)] === Terrain.FLOOR) ctx.set(b.x, b.y, Terrain.STATUE);
  const n = ctx.rng.intRange(2, 3);
  for (let i = 0; i < n; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while ((ctx.tiles[pos] !== Terrain.FLOOR || ctx.heaps.has(pos)) && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    ctx.drop(pos, libraryPrize(ctx));
  }
  if (entrance) upgradeDoor(entrance, DoorType.LOCKED);
  ctx.out.spawnQueue.push(prize('iron-key'));
}

function paintLaboratory(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.WALKWAY);
  const entrance = entranceDoor(room);
  if (entrance) {
    const pot = farCorner(ctx, room, entrance);
    ctx.set(pot.x, pot.y, Terrain.ALCHEMY);
    ctx.out.markers.alchemy.push(ctx.idx(pot.x, pot.y));
  }
  const n = ctx.rng.intRange(2, 3);
  for (let i = 0; i < n; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while ((ctx.tiles[pos] !== Terrain.WALKWAY || ctx.heaps.has(pos)) && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    ctx.drop(pos, labPrize(ctx));
  }
  if (entrance) upgradeDoor(entrance, DoorType.LOCKED);
  ctx.out.spawnQueue.push(prize('iron-key'));
}

function paintMagicWell(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
  const c = roomCenterCell(ctx, room);
  ctx.set(c.x, c.y, Terrain.WELL);
  const kind = ctx.rng.pick(['awareness', 'health', 'transmutation'] as const);
  ctx.out.markers.wells.push({ cell: ctx.idx(c.x, c.y), kind });
  const entrance = entranceDoor(room);
  if (entrance) upgradeDoor(entrance, DoorType.REGULAR);
}

function paintGarden(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.HIGH_GRASS);
  ctx.fillRoomMargin(room, 2, Terrain.GRASS);
  const entrance = entranceDoor(room);
  if (entrance) upgradeDoor(entrance, DoorType.REGULAR);
  if (ctx.rng.int(0, 2) === 0) {
    ctx.drop(randomCell(ctx, room), prize('honeypot'));
  } else {
    const bushes = ctx.rng.int(0, 5) === 0 ? 2 : 1;
    for (let i = 0; i < bushes; i++) {
      const pos = randomCell(ctx, room);
      ctx.tiles[pos] = Terrain.GRASS;
      ctx.drop(pos, prize('sungrass-seed'));
    }
  }
}

const NPIRANHAS = 3;

function paintPool(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.WATER);
  const door = entranceDoor(room);
  if (door) upgradeDoor(door, DoorType.REGULAR);
  let x = -1;
  let y = -1;
  if (door) {
    if (door.x === room.l) {
      x = room.r - 1;
      y = room.t + Math.floor(roomH(room) / 2);
    } else if (door.x === room.r) {
      x = room.l + 1;
      y = room.t + Math.floor(roomH(room) / 2);
    } else if (door.y === room.t) {
      x = room.l + Math.floor(roomW(room) / 2);
      y = room.b - 1;
    } else if (door.y === room.b) {
      x = room.l + Math.floor(roomW(room) / 2);
      y = room.t + 1;
    }
  }
  if (x >= 0) {
    const pos = ctx.idx(x, y);
    ctx.drop(
      pos,
      genericPrize(ctx, ['prize-weapon', 'prize-armor', 'prize-wand', 'prize-ring']),
      ctx.rng.int(0, 3) === 0 ? 'CHEST' : 'HEAP',
    );
    ctx.set(x, y, Terrain.PEDESTAL);
  }
  ctx.out.spawnQueue.push(prize('invisibility'));
  const occupied = new Set<number>();
  for (let i = 0; i < NPIRANHAS; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while ((ctx.tiles[pos] !== Terrain.WATER || occupied.has(pos)) && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    occupied.add(pos);
    ctx.out.mobs.push({ pos, kind: 'piranha' });
  }
}

function paintStatueRoom(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
  const c = roomCenterCell(ctx, room);
  let cx = c.x;
  let cy = c.y;
  const door = entranceDoor(room);
  if (door) {
    upgradeDoor(door, DoorType.LOCKED);
    ctx.out.spawnQueue.push(prize('iron-key'));
    const w = roomW(room);
    const h = roomH(room);
    if (door.x === room.l) {
      ctx.fillRect(room.r - 1, room.t + 1, 1, h - 1, Terrain.STATUE);
      cx = room.r - 2;
    } else if (door.x === room.r) {
      ctx.fillRect(room.l + 1, room.t + 1, 1, h - 1, Terrain.STATUE);
      cx = room.l + 2;
    } else if (door.y === room.t) {
      ctx.fillRect(room.l + 1, room.b - 1, w - 1, 1, Terrain.STATUE);
      cy = room.b - 2;
    } else if (door.y === room.b) {
      ctx.fillRect(room.l + 1, room.t + 1, w - 1, 1, Terrain.STATUE);
      cy = room.t + 2;
    }
  }
  ctx.out.mobs.push({ pos: ctx.idx(cx, cy), kind: 'statue' });
}

function paintTreasury(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
  const c = roomCenterCell(ctx, room);
  ctx.set(c.x, c.y, Terrain.STATUE);
  const heapType: HeapKind = ctx.rng.int(0, 2) === 0 ? 'CHEST' : 'HEAP';
  const n = ctx.rng.intRange(2, 3);
  for (let i = 0; i < n; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while ((ctx.tiles[pos] !== Terrain.FLOOR || ctx.heaps.has(pos)) && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    ctx.drop(
      pos,
      prize(`gold:${ctx.rng.intRange(20 + ctx.depth * 10, 40 + ctx.depth * 20)}`),
      i === 0 && heapType === 'CHEST' ? 'MIMIC' : heapType,
    );
  }
  if (heapType === 'HEAP') {
    for (let i = 0; i < 6; i++) {
      let pos = randomCell(ctx, room);
      let guard = 1000;
      while (ctx.tiles[pos] !== Terrain.FLOOR && guard-- > 0) {
        pos = randomCell(ctx, room);
      }
      ctx.drop(pos, prize(`gold:${ctx.rng.intRange(1, 3)}`));
    }
  }
  const entrance = entranceDoor(room);
  if (entrance) upgradeDoor(entrance, DoorType.LOCKED);
  ctx.out.spawnQueue.push(prize('iron-key'));
}

function paintTrapsRoom(ctx: PainterCtx, room: Room): void {
  const traps = [
    Terrain.TRAP_TOXIC,
    Terrain.TRAP_TOXIC,
    Terrain.TRAP_TOXIC,
    Terrain.TRAP_PARALYTIC,
    Terrain.TRAP_PARALYTIC,
    ctx.bossNext ? Terrain.TRAP_SUMMONING : Terrain.CHASM,
  ];
  ctx.fillRoom(room, Terrain.WALL);
  const trapTile = ctx.rng.pick(traps);
  ctx.fillRoomMargin(room, 1, trapTile);
  if (trapTile !== Terrain.CHASM) {
    const trapIndex = TRAP_ORDER.indexOf(
      trapTile === Terrain.TRAP_TOXIC ? 'toxic' : trapTile === Terrain.TRAP_PARALYTIC ? 'paralytic' : 'summoning',
    );
    for (let j = room.t + 1; j < room.b; j++) {
      for (let i = room.l + 1; i < room.r; i++) {
        ctx.out.traps.push({ x: i, y: j, trap: trapIndex, hidden: false });
      }
    }
  }
  const door = entranceDoor(room);
  if (door) upgradeDoor(door, DoorType.REGULAR);
  const lastRow =
    ctx.tiles[ctx.idx(room.l + 1, room.t + 1)] === Terrain.CHASM ? Terrain.CHASM : Terrain.FLOOR;
  let x = -1;
  let y = -1;
  if (door) {
    const h = roomH(room);
    const w = roomW(room);
    if (door.x === room.l) {
      x = room.r - 1;
      y = room.t + Math.floor(h / 2);
      ctx.fillRect(x, room.t + 1, 1, h - 1, lastRow);
    } else if (door.x === room.r) {
      x = room.l + 1;
      y = room.t + Math.floor(h / 2);
      ctx.fillRect(x, room.t + 1, 1, h - 1, lastRow);
    } else if (door.y === room.t) {
      x = room.l + Math.floor(w / 2);
      y = room.b - 1;
      ctx.fillRect(room.l + 1, y, w - 1, 1, lastRow);
    } else if (door.y === room.b) {
      x = room.l + Math.floor(w / 2);
      y = room.t + 1;
      ctx.fillRect(room.l + 1, y, w - 1, 1, lastRow);
    }
  }
  if (x >= 0) {
    const pos = ctx.idx(x, y);
    const kind = genericPrize(ctx, ['prize-weapon', 'prize-armor', 'prize-wand']);
    if (ctx.rng.int(0, 3) === 0) {
      if (lastRow === Terrain.CHASM) ctx.set(x, y, Terrain.FLOOR);
      ctx.drop(pos, kind, 'CHEST');
    } else {
      ctx.set(x, y, Terrain.PEDESTAL);
      ctx.drop(pos, kind);
    }
  }
  ctx.out.spawnQueue.push(prize('levitation'));
}

function paintStorage(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.WALKWAY);
  const n = ctx.rng.intRange(3, 4);
  for (let i = 0; i < n; i++) {
    let pos = randomCell(ctx, room);
    let guard = 1000;
    while (ctx.tiles[pos] !== Terrain.WALKWAY && guard-- > 0) {
      pos = randomCell(ctx, room);
    }
    ctx.drop(pos, genericPrize(ctx, ['prize-potion', 'prize-scroll', 'prize-food']));
  }
  const entrance = entranceDoor(room);
  if (entrance) upgradeDoor(entrance, DoorType.BARRICADE);
  ctx.out.spawnQueue.push(prize('liquid-flame'));
}

function paintVault(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.WALKWAY);
  ctx.fillRoomMargin(room, 2, Terrain.FLOOR);
  const cx = Math.floor((room.l + room.r) / 2);
  const cy = Math.floor((room.t + room.b) / 2);
  const c = ctx.idx(cx, cy);
  const vaultPrize = (): SpawnKind => genericPrize(ctx, ['prize-wand', 'prize-ring']);
  switch (ctx.rng.int(0, 3)) {
    case 0:
      ctx.drop(c, vaultPrize(), 'LOCKED_CHEST');
      ctx.out.spawnQueue.push(prize('golden-key'));
      break;
    case 1: {
      const i1 = vaultPrize();
      const i2 = vaultPrize();
      ctx.drop(c, i1, 'CRYSTAL_CHEST');
      const n = ctx.rng.int(0, 8);
      const dx = [-1, 0, 1, -1, 1, -1, 0, 1][n]!;
      const dy = [-1, -1, -1, 0, 0, 1, 1, 1][n]!;
      ctx.drop(ctx.idx(cx + dx, cy + dy), i2, 'CRYSTAL_CHEST');
      ctx.out.spawnQueue.push(prize('golden-key'));
      break;
    }
    default:
      ctx.drop(c, vaultPrize());
      ctx.set(cx, cy, Terrain.PEDESTAL);
      break;
  }
  const entrance = entranceDoor(room);
  if (entrance) upgradeDoor(entrance, DoorType.LOCKED);
  ctx.out.spawnQueue.push(prize('iron-key'));
}

function paintAltar(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, ctx.bossNext ? Terrain.HIGH_GRASS : Terrain.CHASM);
  const c = roomCenterCell(ctx, room);
  const door = entranceDoor(room);
  if (door) {
    if (door.x === room.l || door.x === room.r) {
      const p = drawInside(ctx, room, door, Math.abs(door.x - c.x) - 2, Terrain.WALKWAY);
      for (; p.y !== c.y; p.y += p.y < c.y ? 1 : -1) ctx.set(p.x, p.y, Terrain.WALKWAY);
    } else {
      const p = drawInside(ctx, room, door, Math.abs(door.y - c.y) - 2, Terrain.WALKWAY);
      for (; p.x !== c.x; p.x += p.x < c.x ? 1 : -1) ctx.set(p.x, p.y, Terrain.WALKWAY);
    }
  }
  ctx.fillRect(c.x - 1, c.y - 1, 3, 3, Terrain.EMBERS);
  ctx.set(c.x, c.y, Terrain.PEDESTAL);
  if (door) upgradeDoor(door, DoorType.EMPTY);
}

function paintWeakFloor(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.CHASM);
  const door = entranceDoor(room);
  if (door) upgradeDoor(door, DoorType.REGULAR);
  if (!door) return;
  const w = roomW(room);
  const h = roomH(room);
  if (door.x === room.l) {
    for (let i = room.t + 1; i < room.b; i++) {
      drawInside(ctx, room, { x: room.l, y: i }, ctx.rng.intRange(1, w - 2), Terrain.WALKWAY);
    }
  } else if (door.x === room.r) {
    for (let i = room.t + 1; i < room.b; i++) {
      drawInside(ctx, room, { x: room.r, y: i }, ctx.rng.intRange(1, w - 2), Terrain.WALKWAY);
    }
  } else if (door.y === room.t) {
    for (let i = room.l + 1; i < room.r; i++) {
      drawInside(ctx, room, { x: i, y: room.t }, ctx.rng.intRange(1, h - 2), Terrain.WALKWAY);
    }
  } else if (door.y === room.b) {
    for (let i = room.l + 1; i < room.r; i++) {
      drawInside(ctx, room, { x: i, y: room.b }, ctx.rng.intRange(1, h - 2), Terrain.WALKWAY);
    }
  }
}

function paintPit(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
  const entrance = entranceDoor(room);
  if (entrance) upgradeDoor(entrance, DoorType.LOCKED);
  if (entrance) {
    const well = farCorner(ctx, room, entrance);
    ctx.set(well.x, well.y, Terrain.FLOOR);
    ctx.out.markers.dryWells.push(ctx.idx(well.x, well.y));
  }
  const dry = new Set(ctx.out.markers.dryWells);
  let remains = randomCell(ctx, room);
  let guard = 1000;
  while (dry.has(remains) && guard-- > 0) remains = randomCell(ctx, room);
  ctx.drop(remains, prize('iron-key'), 'SKELETON');
  const ringOrWeapon =
    ctx.rng.int(0, 5) === 0 ? 'prize-ring' : ctx.rng.pick(['prize-weapon', 'prize-armor'] as const);
  ctx.drop(remains, prize(ringOrWeapon));
  const n = ctx.rng.intRange(1, 2);
  for (let i = 0; i < n; i++) {
    ctx.drop(remains, genericPrize(ctx, ['prize-potion', 'prize-scroll']));
  }
}

function paintRatKing(ctx: PainterCtx, room: Room): void {
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.WALKWAY);
  const entrance = entranceDoor(room);
  if (entrance) upgradeDoor(entrance, DoorType.HIDDEN);
  const doorCell = entrance ? ctx.idx(entrance.x, entrance.y) : -1;
  const W = ctx.width;
  const addChest = (pos: number): void => {
    if (pos === doorCell - 1 || pos === doorCell + 1 || pos === doorCell - W || pos === doorCell + W) {
      return;
    }
    const r = ctx.rng.int(0, 10);
    const kind: SpawnKind =
      r === 0 ? prize('prize-weapon') : r === 1 ? prize('prize-armor') : prize(`gold:${ctx.rng.intRange(1, 5)}`);
    ctx.drop(pos, kind, 'CHEST');
  };
  const before = ctx.out.items.length;
  for (let i = room.l + 1; i < room.r; i++) {
    addChest(ctx.idx(i, room.t + 1));
    addChest(ctx.idx(i, room.b - 1));
  }
  for (let i = room.t + 2; i < room.b - 1; i++) {
    addChest(ctx.idx(room.l + 1, i));
    addChest(ctx.idx(room.r - 1, i));
  }
  // Vanilla: a random heap cell's chest becomes a mimic.
  const chests = ctx.out.items.slice(before);
  if (chests.length > 0) {
    ctx.rng.pick(chests).heap = 'MIMIC';
  }
  const king = randomCell(ctx, room, 1);
  ctx.out.mobs.push({ pos: king, kind: 'ratking' });
}

/**
 * Paint every room (vanilla `RegularLevel.paint` iterates the rooms
 * HashSet; this port uses a deterministic y/x order — see report).
 * NULL rooms on a CHASM feeling are filled with WALL half the time.
 */
export function paintRooms(ctx: PainterCtx, rooms: Room[]): { entrance: number; exit: number } {
  let entrance = -1;
  let exit = -1;
  const ordered = [...rooms].sort((a, b) => a.t - b.t || a.l - b.l);
  for (const room of ordered) {
    if (room.type === RoomType.NULL) {
      if (ctx.feeling === 'chasm' && ctx.rng.int(0, 2) === 0) {
        ctx.fillRoom(room, Terrain.WALL);
      }
      continue;
    }
    // Vanilla `placeDoors(r)` before each room's painter.
    for (const n of room.carvedTo) placeDoor(ctx.rng, room, n);
    switch (room.type) {
      case RoomType.STANDARD:
        paintStandard(ctx, room);
        break;
      case RoomType.TUNNEL:
        paintTunnel(ctx, room);
        break;
      case RoomType.PASSAGE:
        paintPassage(ctx, room);
        break;
      case RoomType.SHOP:
        paintShopRoom(ctx, room);
        break;
      case RoomType.ENTRANCE:
        entrance = paintEntrance(ctx, room);
        break;
      case RoomType.EXIT:
        exit = paintExit(ctx, room);
        break;
      case RoomType.BOSS_EXIT:
        exit = paintBossExit(ctx, room);
        break;
      case RoomType.ARMORY:
        paintArmory(ctx, room);
        break;
      case RoomType.MAGIC_WELL:
        paintMagicWell(ctx, room);
        break;
      case RoomType.CRYPT:
        paintCrypt(ctx, room);
        break;
      case RoomType.POOL:
        paintPool(ctx, room);
        break;
      case RoomType.GARDEN:
        paintGarden(ctx, room);
        break;
      case RoomType.LIBRARY:
        paintLibrary(ctx, room);
        break;
      case RoomType.TREASURY:
        paintTreasury(ctx, room);
        break;
      case RoomType.TRAPS:
        paintTrapsRoom(ctx, room);
        break;
      case RoomType.STORAGE:
        paintStorage(ctx, room);
        break;
      case RoomType.STATUE:
        paintStatueRoom(ctx, room);
        break;
      case RoomType.LABORATORY:
        paintLaboratory(ctx, room);
        break;
      case RoomType.VAULT:
        paintVault(ctx, room);
        break;
      case RoomType.ALTAR:
        paintAltar(ctx, room);
        break;
      case RoomType.WEAK_FLOOR:
        paintWeakFloor(ctx, room);
        break;
      case RoomType.PIT:
        paintPit(ctx, room);
        break;
      case RoomType.RAT_KING:
        paintRatKing(ctx, room);
        break;
      default:
        ctx.fillRoomMargin(room, 1, Terrain.FLOOR);
        break;
    }
  }
  return { entrance, exit };
}

// ------------------------------------------------------------ level decoration

/**
 * Vanilla `Patch.generate`: cellular-automata blob field. Smoothing only
 * touches interior cells; border cells keep their initial random values.
 * (Vanilla used static arrays, so borders leaked state from previous calls;
 * this port uses fresh arrays — borders stay false — for per-seed
 * determinism. See docs/DUNGEON-REPORT.md.)
 */
export function generatePatch(rng: RNG, fillRate: number, cleanPasses: number, w: number, h: number): boolean[] {
  const size = w * h;
  let off = new Array<boolean>(size);
  for (let i = 0; i < size; i++) off[i] = rng.float(0, 1) < fillRate;
  for (let p = 0; p < cleanPasses; p++) {
    const cur = new Array<boolean>(size).fill(false);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const pos = x + y * w;
        let count = 0;
        if (off[pos - w - 1]) count++;
        if (off[pos - w]) count++;
        if (off[pos - w + 1]) count++;
        if (off[pos - 1]) count++;
        if (off[pos + 1]) count++;
        if (off[pos + w - 1]) count++;
        if (off[pos + w]) count++;
        if (off[pos + w + 1]) count++;
        cur[pos] = !off[pos] ? count >= 5 : count >= 4;
      }
    }
    off = cur;
  }
  return off;
}

/**
 * Vanilla `RegularLevel.paintWater` / `paintGrass` for the sewers:
 * water blobs over EMPTY; grass blobs over EMPTY (with GRASS-feeling corner
 * forcing and the HIGH_GRASS density roll).
 */
export function paintWaterGrass(
  ctx: PainterCtx,
  rooms: Room[],
  waterFill?: number,
  grassFill?: number,
  waterPasses = 5,
  grassPasses = 4,
): void {
  const W = ctx.width;
  const H = ctx.height;
  const water = generatePatch(
    ctx.rng,
    waterFill ?? (ctx.feeling === 'water' ? 0.6 : 0.45),
    waterPasses,
    W,
    H,
  );
  for (let i = 0; i < W * H; i++) {
    if (ctx.tiles[i] === Terrain.FLOOR && water[i]) ctx.tiles[i] = Terrain.WATER;
  }
  const grass = generatePatch(
    ctx.rng,
    grassFill ?? (ctx.feeling === 'grass' ? 0.6 : 0.4),
    grassPasses,
    W,
    H,
  );
  if (ctx.feeling === 'grass') {
    for (const room of rooms) {
      if (room.type !== RoomType.NULL && room.type !== RoomType.PASSAGE && room.type !== RoomType.TUNNEL) {
        grass[ctx.idx(room.l + 1, room.t + 1)] = true;
        grass[ctx.idx(room.r - 1, room.t + 1)] = true;
        grass[ctx.idx(room.l + 1, room.b - 1)] = true;
        grass[ctx.idx(room.r - 1, room.b - 1)] = true;
      }
    }
  }
  for (let i = W + 1; i < W * H - W - 1; i++) {
    if (ctx.tiles[i] === Terrain.FLOOR && grass[i]) {
      let count = 1;
      const x = i % W;
      const y = Math.floor(i / W);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && grass[ny * W + nx]) count++;
        }
      }
      ctx.tiles[i] = ctx.rng.float(0, 1) < count / 12 ? Terrain.HIGH_GRASS : Terrain.GRASS;
    }
  }
}

/**
 * Vanilla `RegularLevel.paintDoors`: each unique shared door becomes a tile
 * (or an open passage via `joinRooms`). REGULAR doors are secret with
 * `Int(12-depth)==0` on depths 2-5 (depth 1 always ordinary); BARRICADE is
 * a bookshelf 1/3 of the time.
 *
 * Vanilla paints each door twice (once per room, re-rolling); this port
 * paints each unique door once — see docs/DUNGEON-REPORT.md.
 */
export function paintDoorTiles(ctx: PainterCtx, rooms: Room[]): number {
  let secretDoors = 0;
  const seen = new Set<Door>();
  const tileFor = (d: Door): Terrain => {
    switch (d.type) {
      case DoorType.EMPTY:
        return Terrain.FLOOR;
      case DoorType.TUNNEL:
        return ctx.feeling === 'chasm' ? Terrain.WALKWAY : Terrain.FLOOR;
      case DoorType.REGULAR:
        if (ctx.depth <= 1) return Terrain.DOOR;
        // Vanilla RegularLevel.paintDoors (RegularLevel.java:532):
        // Random.Int(12-depth) below depth 6, fixed Random.Int(6) at 6+.
        if (ctx.rng.int(0, ctx.depth < 6 ? 12 - ctx.depth : 6) === 0) {
          secretDoors++;
          return Terrain.DOOR_SECRET;
        }
        return Terrain.DOOR;
      case DoorType.UNLOCKED:
        return Terrain.DOOR;
      case DoorType.HIDDEN:
        secretDoors++;
        return Terrain.DOOR_SECRET;
      case DoorType.BARRICADE:
        return ctx.rng.int(0, 3) === 0 ? Terrain.BOOKSHELF : Terrain.BARRICADE;
      case DoorType.LOCKED:
        return Terrain.DOOR_LOCKED;
    }
  };
  for (const room of rooms) {
    for (const n of room.carvedTo) {
      const door = room.doors.find((d) => n.doors.includes(d));
      if (!door || seen.has(door)) continue;
      seen.add(door);
      // Vanilla `paintDoors`: joined STANDARD<->STANDARD pairs become an
      // open passage instead of a door tile.
      const joined = joinRooms(room, n);
      if (joined) {
        for (const c of joined) ctx.set(c.x, c.y, Terrain.FLOOR);
        continue;
      }
      const tile = tileFor(door);
      ctx.set(door.x, door.y, tile);
      ctx.out.doors.push({ x: door.x, y: door.y, type: door.type, tile });
    }
  }
  return secretDoors;
}

/**
 * Vanilla `PrisonBossLevel.paintDoors` (PrisonBossLevel.java:175-193): no
 * secret doors; PASSAGE<->PASSAGE joints are left open (EMPTY); every other
 * door is a plain DOOR. The arena entrance is upgraded to a LOCKED_DOOR by
 * the generator (PrisonBossLevel.decorate, PrisonBossLevel.java:243).
 *
 * Returns the secret-door count (always 0 on the Tengu level).
 */
export function paintPrisonBossDoors(
  ctx: PainterCtx,
  rooms: Room[],
  exitRoom: Room,
  arenaDoor: Door | null,
): number {
  const seen = new Set<Door>();
  for (const room of rooms) {
    if (room.type === RoomType.NULL) continue;
    for (const n of room.carvedTo) {
      const door = room.doors.find((d) => n.doors.includes(d));
      if (!door || seen.has(door)) continue;
      seen.add(door);
      let tile: Terrain;
      if (door === arenaDoor) {
        upgradeDoor(door, DoorType.LOCKED);
        tile = Terrain.DOOR_LOCKED;
      } else if (room.type === RoomType.PASSAGE && n.type === RoomType.PASSAGE) {
        tile = Terrain.FLOOR; // vanilla EMPTY: not a door at all
      } else {
        upgradeDoor(door, DoorType.REGULAR);
        tile = Terrain.DOOR;
      }
      ctx.set(door.x, door.y, tile);
      if (tile !== Terrain.FLOOR) {
        ctx.out.doors.push({ x: door.x, y: door.y, type: door.type, tile });
      }
    }
  }
  return 0;
}

/**
 * Vanilla `PrisonBossLevel.placeTraps` (PrisonBossLevel.java:219-234): only
 * POISON_TRAP, placed visibly (no hidden variants on the Tengu level).
 */
export function placePoisonTraps(
  ctx: PainterCtx,
  rooms: Room[],
): { attempts: number; placed: number } {
  const nTraps = ctx.depth <= 1 ? 0 : ctx.rng.int(1, rooms.length + ctx.depth);
  let placed = 0;
  for (let i = 0; i < nTraps; i++) {
    const cell = ctx.rng.int(0, ctx.width * ctx.height);
    if (ctx.tiles[cell] === Terrain.FLOOR) {
      ctx.tiles[cell] = Terrain.TRAP_POISON;
      ctx.out.traps.push({ x: ctx.x(cell), y: ctx.y(cell), trap: 3, hidden: false });
      placed++;
    }
  }
  return { attempts: nTraps, placed };
}

/**
 * Vanilla `RegularLevel.placeTraps`: `nTraps` attempts; each picks a random
 * map cell and places a uniformly-random trap class only when the cell is
 * EMPTY (attempts may fail — never forced). Trap classes are the 8 vanilla
 * trap types in `TRAP_ORDER`.
 */
export function placeTraps(ctx: PainterCtx, rooms: Room[]): { attempts: number; placed: number } {
  const nTraps = ctx.depth <= 1 ? 0 : ctx.rng.int(1, rooms.length + ctx.depth);
  let placed = 0;
  for (let i = 0; i < nTraps; i++) {
    const cell = ctx.rng.int(0, ctx.width * ctx.height);
    if (ctx.tiles[cell] === Terrain.FLOOR) {
      const trap = ctx.rng.int(0, 8);
      ctx.tiles[cell] = (Terrain.TRAP_TOXIC_HIDDEN + trap * 2) as Terrain;
      ctx.out.traps.push({ x: ctx.x(cell), y: ctx.y(cell), trap, hidden: true });
      placed++;
    }
  }
  return { attempts: nTraps, placed };
}

/**
 * Vanilla `SewerLevel.decorate`: wall-deco strips above water, scattered
 * empty-deco, and a sign in the entrance room. (WALL_DECO/EMPTY_DECO/SIGN
 * have no ids in the shared Terrain contract, so tiles stay WALL/FLOOR and
 * positions are recorded in markers.)
 */
export function decorateSewers(ctx: PainterCtx, entranceRoom: Room, entranceCell: number): void {
  const W = ctx.width;
  const H = ctx.height;
  const rng = ctx.rng;
  for (let i = 0; i < W; i++) {
    if (ctx.tiles[i] === Terrain.WALL && ctx.tiles[i + W] === Terrain.WATER && rng.int(0, 4) === 0) {
      ctx.out.markers.wallDeco.push(i);
    }
  }
  for (let i = W; i < W * H - W; i++) {
    if (
      ctx.tiles[i] === Terrain.WALL &&
      ctx.tiles[i - W] === Terrain.WALL &&
      ctx.tiles[i + W] === Terrain.WATER &&
      rng.int(0, 2) === 0
    ) {
      ctx.out.markers.wallDeco.push(i);
    }
  }
  const DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (let i = W + 1; i < W * H - W - 1; i++) {
    if (ctx.tiles[i] === Terrain.FLOOR) {
      const x = i % W;
      const y = Math.floor(i / W);
      let count = 0;
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && ctx.tiles[ny * W + nx] === Terrain.WALL) count++;
      }
      if (rng.int(0, 16) < count * count) {
        ctx.out.markers.emptyDeco.push(i);
      }
    }
  }
  placeSign(ctx, entranceRoom, entranceCell);
}

/** The entrance-room sign, shared by SewerLevel and SewerBossLevel. */
export function placeSign(ctx: PainterCtx, entranceRoom: Room, entranceCell: number): void {
  while (true) {
    const pos = randomCell(ctx, entranceRoom);
    if (pos !== entranceCell) {
      ctx.out.markers.signs.push(pos);
      break;
    }
  }
}

/**
 * Vanilla `SewerBossLevel.decorate`: the arena's top interior row becomes
 * WALL_DECO (recorded; tile stays WALL) with WATER below — except the exit
 * column, which stays clear with EMPTY below.
 */
export function decorateBoss(ctx: PainterCtx, exitRoom: Room, exitCell: number): void {
  const W = ctx.width;
  const start = exitRoom.t * W + exitRoom.l + 1;
  const end = start + roomW(exitRoom) - 1;
  for (let i = start; i < end; i++) {
    if (i !== exitCell) {
      ctx.out.markers.wallDeco.push(i);
      ctx.tiles[i + W] = Terrain.WATER;
    } else {
      ctx.tiles[i + W] = Terrain.FLOOR;
    }
  }
  // The sign in the entrance room is shared with SewerLevel.decorate.
}

/**
 * Shared blood-stain / torch-wall / sign pass for PrisonLevel and
 * PrisonBossLevel. `base` is the EMPTY_DECO base chance (0.05 prison,
 * 0.15 boss); `torchTop`/`torchInner` are the Random.Int odds for torch
 * WALL_DECO on the top row (6/4) and supported walls below (3/2).
 */
function decoratePrisonCore(
  ctx: PainterCtx,
  entranceRoom: Room,
  entranceCell: number,
  base: number,
  torchTop: number,
  torchInner: number,
): void {
  const W = ctx.width;
  const H = ctx.height;
  const rng = ctx.rng;
  // Blood stains: EMPTY with +0.2 per wall-corner pairing.
  for (let i = W + 1; i < W * H - W - 1; i++) {
    if (ctx.tiles[i] === Terrain.FLOOR) {
      let c = base;
      if (ctx.tiles[i + 1] === Terrain.WALL && ctx.tiles[i + W] === Terrain.WALL) c += 0.2;
      if (ctx.tiles[i - 1] === Terrain.WALL && ctx.tiles[i + W] === Terrain.WALL) c += 0.2;
      if (ctx.tiles[i + 1] === Terrain.WALL && ctx.tiles[i - W] === Terrain.WALL) c += 0.2;
      if (ctx.tiles[i - 1] === Terrain.WALL && ctx.tiles[i - W] === Terrain.WALL) c += 0.2;
      if (rng.float(0, 1) < c) ctx.out.markers.emptyDeco.push(i);
    }
  }
  // Torch walls: EMPTY_SP counts as open floor (vanilla EMPTY_SP).
  const openBelow = (i: number): boolean => {
    const t = ctx.tiles[i + W];
    return t === Terrain.FLOOR || t === Terrain.WALKWAY;
  };
  for (let i = 0; i < W; i++) {
    if (ctx.tiles[i] === Terrain.WALL && openBelow(i) && rng.int(0, torchTop) === 0) {
      ctx.out.markers.wallDeco.push(i);
    }
  }
  for (let i = W; i < W * H - W; i++) {
    if (
      ctx.tiles[i] === Terrain.WALL &&
      ctx.tiles[i - W] === Terrain.WALL &&
      openBelow(i) &&
      rng.int(0, torchInner) === 0
    ) {
      ctx.out.markers.wallDeco.push(i);
    }
  }
  placeSign(ctx, entranceRoom, entranceCell);
}

/**
 * Vanilla `PrisonLevel.decorate` (PrisonLevel.java:103-130): blood-stain
 * EMPTY_DECO (base 0.05), torch WALL_DECO (1-in-6 top row, 1-in-3 supported
 * walls), and a sign in the entrance room.
 */
export function decoratePrison(ctx: PainterCtx, entranceRoom: Room, entranceCell: number): void {
  decoratePrisonCore(ctx, entranceRoom, entranceCell, 0.05, 6, 3);
}

/**
 * Vanilla `PrisonBossLevel.decorate` (PrisonBossLevel.java:213-273):
 * blood-stain EMPTY_DECO (base 0.15), torch WALL_DECO (1-in-4 top row, 1-in-2
 * supported walls), a sign in the entrance room, and the arena interior
 * filled with INACTIVE_TRAP. (The arena-door LOCKED_DOOR is painted by
 * paintPrisonBossDoors.)
 */
export function decoratePrisonBoss(
  ctx: PainterCtx,
  entranceRoom: Room,
  entranceCell: number,
  exitRoom: Room,
): void {
  decoratePrisonCore(ctx, entranceRoom, entranceCell, 0.15, 4, 2);
  ctx.fillRect(
    exitRoom.l + 2,
    exitRoom.t + 2,
    roomW(exitRoom) - 3,
    roomH(exitRoom) - 3,
    Terrain.TRAP_INACTIVE,
  );
}
