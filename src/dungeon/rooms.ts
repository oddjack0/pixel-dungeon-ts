import type { RNG } from '../core/rng.js';

/**
 * Room graph: BSP room splitting, neighbor detection, the entrance->exit
 * connection plan, special-room assignment, and shared door objects.
 *
 * Faithful to vanilla `levels/Room.java` + `levels/RegularLevel.java` +
 * `levels/SewerBossLevel.java` (this repo's vintage). Where the verified
 * oracle (~/workspace/pixel-dungeon-ts/src/dungeon/) deviates from the Java
 * source, the Java source wins — see docs/DUNGEON-REPORT.md.
 *
 * Bounds convention (vanilla `Rect`): bounds are INCLUSIVE. A room
 * (l, t, r, b) covers cells [l, r] x [t, b]. `roomW`/`roomH` match vanilla
 * `width()`/`height()` (right - left, i.e. span minus one).
 */

/** Vanilla `Room.Type` (painters bound per type in painters.ts). */
export enum RoomType {
  NULL,
  STANDARD,
  ENTRANCE,
  EXIT,
  BOSS_EXIT,
  TUNNEL,
  PASSAGE,
  SHOP,
  BLACKSMITH,
  TREASURY,
  ARMORY,
  LIBRARY,
  LABORATORY,
  VAULT,
  TRAPS,
  STORAGE,
  MAGIC_WELL,
  GARDEN,
  CRYPT,
  STATUE,
  POOL,
  RAT_KING,
  WEAK_FLOOR,
  PIT,
  ALTAR,
}

/** Vanilla `Room.Door.Type`. */
export enum DoorType {
  EMPTY,
  TUNNEL,
  REGULAR,
  UNLOCKED,
  HIDDEN,
  BARRICADE,
  LOCKED,
}

/** One door shared by a connected room pair, on their shared wall segment. */
export interface Door {
  x: number;
  y: number;
  type: DoorType;
}

/**
 * Vanilla `Door.set`: monotonic — a painter can only *upgrade* a door to a
 * higher ordinal, never downgrade it. This makes the final door type
 * independent of room paint order (vanilla iterated a HashSet).
 */
export function upgradeDoor(door: Door, type: DoorType): void {
  if (type > door.type) door.type = type;
}

/** Inclusive bounds: covers [l, r] x [t, b]. */
export interface Room {
  l: number;
  t: number;
  r: number;
  b: number;
  type: RoomType;
  /** Spatial neighbors (shared wall segment >= 3). */
  neighbours: Room[];
  /**
   * Rooms actually connected to this one (doors / joined openings), in carve
   * order. (Vanilla used a HashMap; the array keeps `entranceDoor` stable
   * across runs for the same seed.)
   */
  carvedTo: Room[];
  /** Shared Door objects, one per connected pair. */
  doors: Door[];
  /** Per-node path price (vanilla Graph.Node.price). */
  price: number;
}

export function makeRoom(l: number, t: number, r: number, b: number): Room {
  return { l, t, r, b, type: RoomType.NULL, neighbours: [], carvedTo: [], doors: [], price: 1 };
}

/** Vanilla `Rect.width()`. */
export const roomW = (r: Room): number => r.r - r.l;
/** Vanilla `Rect.height()`. */
export const roomH = (r: Room): number => r.b - r.t;

/** Vanilla `Room.center()` (with the odd-size jitter). */
export function roomCenter(rng: RNG, r: Room): { x: number; y: number } {
  return {
    x: Math.floor((r.l + r.r) / 2) + (roomW(r) % 2 === 1 ? rng.int(0, 2) : 0),
    y: Math.floor((r.t + r.b) / 2) + (roomH(r) % 2 === 1 ? rng.int(0, 2) : 0),
  };
}

/**
 * Vanilla `Room.random(m)`: x in [l+1+m, r-m), y in [t+1+m, b-m) —
 * interior excluding the wall ring.
 */
export function randomRoomCell(rng: RNG, r: Room, margin = 0): { x: number; y: number } {
  return {
    x: rng.int(r.l + 1 + margin, r.r - margin),
    y: rng.int(r.t + 1 + margin, r.b - margin),
  };
}

const MIN_ROOM = 7;
const MAX_ROOM = 9;
const MIN_ROOMS = 8;

/**
 * Vanilla `RegularLevel.split` over Rect(0, 0, 31, 31) (inclusive).
 *
 * Fidelity notes:
 * - The stop condition's random clause uses Java *integer* division:
 *   `(49 / (w*h))` is 0 for every rect bigger than 7x7 and 1 exactly at
 *   7x7 — so rects effectively split until one side drops below 7
 *   (the oracle used float division, which splits far less often).
 * - Vanilla used `Math.random()` (unseeded!) for that clause; this port
 *   uses the seeded RNG so the same seed always yields the same map
 *   (documented in docs/DUNGEON-REPORT.md).
 * - Children share the split line (e.g. (l,t,vw,b) and (vw,t,r,b)),
 *   i.e. the shared wall column/row belongs to both rooms.
 */
export function buildRooms(rng: RNG): Room[] | null {
  const rooms: Room[] = [];

  const split = (l: number, t: number, r: number, b: number): void => {
    const w = r - l;
    const h = b - t;
    if (w > MAX_ROOM && h < MIN_ROOM) {
      const vw = rng.int(l + 3, r - 3);
      split(l, t, vw, b);
      split(vw, t, r, b);
    } else if (h > MAX_ROOM && w < MIN_ROOM) {
      const vh = rng.int(t + 3, b - 3);
      split(l, t, r, vh);
      split(l, vh, r, b);
    } else if (
      (rng.float(0, 1) <= Math.floor((MIN_ROOM * MIN_ROOM) / (w * h)) && w <= MAX_ROOM && h <= MAX_ROOM) ||
      w < MIN_ROOM ||
      h < MIN_ROOM
    ) {
      rooms.push(makeRoom(l, t, r, b));
    } else if (rng.float(0, 1) < (w - 2) / (w + h - 4)) {
      const vw = rng.int(l + 3, r - 3);
      split(l, t, vw, b);
      split(vw, t, r, b);
    } else {
      const vh = rng.int(t + 3, b - 3);
      split(l, t, r, vh);
      split(l, vh, r, b);
    }
  };

  split(0, 0, 31, 31);
  if (rooms.length < MIN_ROOMS) return null;

  // Vanilla `addNeigbour`: intersect rect with one zero side and the other >= 3.
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]!;
      const b = rooms[j]!;
      const il = Math.max(a.l, b.l);
      const it = Math.max(a.t, b.t);
      const ir = Math.min(a.r, b.r);
      const ib = Math.min(a.b, b.b);
      if ((ir - il === 0 && ib - it >= 3) || (ib - it === 0 && ir - il >= 3)) {
        a.neighbours.push(b);
        b.neighbours.push(a);
      }
    }
  }
  return rooms;
}

/** Vanilla `Graph.buildDistanceMap` (per-node prices). */
export function buildDistanceMap(rooms: Room[], focus: Room): Map<Room, number> {
  const dist = new Map<Room, number>();
  for (const r of rooms) dist.set(r, Infinity);
  dist.set(focus, 0);
  const queue: Room[] = [focus];
  while (queue.length > 0) {
    const node = queue.shift()!;
    const d = dist.get(node)!;
    for (const edge of node.neighbours) {
      if (dist.get(edge)! > d + node.price) {
        dist.set(edge, d + node.price);
        queue.push(edge);
      }
    }
  }
  return dist;
}

/**
 * Vanilla `Graph.buildPath`: greedy descent from `from` to `to` along
 * strictly decreasing distance. Returns null when stuck.
 * (This vintage calls it with no avoid-set; the second path avoids the first
 * purely through `setPrice`.)
 */
export function buildPath(from: Room, to: Room, dist: Map<Room, number>): Room[] | null {
  const path: Room[] = [];
  let room = from;
  let guard = 100000;
  while (room !== to && guard-- > 0) {
    let min = dist.get(room)!;
    let next: Room | null = null;
    for (const edge of room.neighbours) {
      const d = dist.get(edge)!;
      if (d < min) {
        min = d;
        next = edge;
      }
    }
    if (!next) return null;
    path.push(next);
    room = next;
  }
  return room === to ? path : null;
}

/** Vanilla `Graph.setPrice`. */
export function setPrice(path: Room[], price: number): void {
  for (const r of path) r.price = price;
}

function connectRooms(a: Room, b: Room): void {
  if (a.carvedTo.includes(b)) return;
  a.carvedTo.push(b);
  b.carvedTo.push(a);
}

export interface PlanOptions {
  /** Minimum room width()/height() for the exit room (4 regular, 6 Goo). */
  exitMinSize: number;
  /** Exit room may not touch the top map edge (boss levels). */
  exitTopNotZero?: boolean;
  /** Room type for the exit room. */
  exitType: RoomType;
  /** Regular levels connect both paths; boss levels only the second. */
  connectFirstPath: boolean;
  /** Regular levels add random links to 50-70% connected. */
  fillRandom: boolean;
}

export interface ConnectionPlan {
  entrance: Room;
  exit: Room;
  connected: Set<Room>;
}

/**
 * Entrance/exit selection + path carving (`RegularLevel.build`).
 * Vanilla: up to 11 outer attempts (`if (retry++ > 10) return false`),
 * graph distance >= (int)sqrt(room count). Unbounded inner picks for
 * >= 4x4 rooms (capped here at a large safety bound; vanilla would spin).
 * Returns null when selection fails (caller rebuilds the level).
 */
export function planConnections(rng: RNG, rooms: Room[], opts: PlanOptions): ConnectionPlan | null {
  const minDistance = Math.floor(Math.sqrt(rooms.length));

  let entrance: Room | null = null;
  let exit: Room | null = null;
  for (let attempt = 0; attempt < 11; attempt++) {
    let e: Room | null = null;
    for (let i = 0; i < 1000; i++) {
      const r = rng.pick(rooms);
      if (roomW(r) >= 4 && roomH(r) >= 4) {
        e = r;
        break;
      }
    }
    if (!e) return null;
    let x: Room | null = null;
    for (let i = 0; i < 1000; i++) {
      const r = rng.pick(rooms);
      if (r !== e && roomW(r) >= opts.exitMinSize && roomH(r) >= opts.exitMinSize && (!opts.exitTopNotZero || r.t !== 0)) {
        x = r;
        break;
      }
    }
    if (!x) return null;
    const dist = buildDistanceMap(rooms, x);
    if (dist.get(e)! >= minDistance) {
      entrance = e;
      exit = x;
      break;
    }
  }
  if (!entrance || !exit) return null;

  entrance.type = RoomType.ENTRANCE;
  exit.type = opts.exitType;

  const connected = new Set<Room>([entrance]);

  const carve = (path: Room[] | null): void => {
    if (!path) return;
    let room = entrance!;
    for (const next of path) {
      connectRooms(room, next);
      connected.add(next);
      room = next;
    }
  };

  // First path: priced up but (for boss levels) not connected.
  let dist = buildDistanceMap(rooms, exit);
  let path = buildPath(entrance, exit, dist);
  if (!path) return null;
  if (opts.connectFirstPath) carve(path);
  setPrice(path, dist.get(entrance)!);

  // Second path avoids the first via the priced distances.
  dist = buildDistanceMap(rooms, exit);
  path = buildPath(entrance, exit, dist);
  if (!path) return null;
  carve(path);

  if (opts.fillRandom) {
    const nConnected = Math.floor(rooms.length * rng.float(0.5, 0.7));
    let guard = rooms.length * 20;
    while (connected.size < nConnected && guard-- > 0) {
      const cr = rng.pick([...connected]);
      if (cr.neighbours.length === 0) continue;
      const or = rng.pick(cr.neighbours);
      if (!connected.has(or)) {
        connectRooms(cr, or);
        connected.add(or);
      }
    }
  }

  return { entrance, exit, connected };
}

export interface BossPlan {
  entrance: Room;
  exit: Room;
  /** The single room the exit connects to (must not sit above the arena). */
  approach: Room;
}

/**
 * `SewerBossLevel.build` connection logic: entrance (>= 4x4, up to 11 inner
 * attempts) and exit (>= 6x6, not on the top edge, up to 11 inner attempts),
 * up to 11 outer attempts on distance; only the second (priced) path is
 * carved; connected NULL rooms become TUNNEL; a Rat King room may attach to
 * the arena's flank or south side (never its top).
 */
export function planBossConnections(rng: RNG, rooms: Room[]): BossPlan | null {
  const minDistance = Math.floor(Math.sqrt(rooms.length));

  let entrance: Room | null = null;
  let exit: Room | null = null;
  for (let attempt = 0; attempt < 11; attempt++) {
    let innerRetry = 0;
    let e: Room | null = null;
    while (innerRetry++ <= 10) {
      const cand = rng.pick(rooms);
      if (roomW(cand) >= 4 && roomH(cand) >= 4) {
        e = cand;
        break;
      }
    }
    if (!e) return null;
    innerRetry = 0;
    let x: Room | null = null;
    while (innerRetry++ <= 10) {
      const cand = rng.pick(rooms);
      if (cand !== e && roomW(cand) >= 6 && roomH(cand) >= 6 && cand.t !== 0) {
        x = cand;
        break;
      }
    }
    if (!x) return null;
    const dist = buildDistanceMap(rooms, x);
    if (dist.get(e)! >= minDistance) {
      entrance = e;
      exit = x;
      break;
    }
  }
  if (!entrance || !exit) return null;

  entrance.type = RoomType.ENTRANCE;
  exit.type = RoomType.BOSS_EXIT;

  // First path: priced but NOT connected (boss levels carve only the second).
  let dist = buildDistanceMap(rooms, exit);
  let path = buildPath(entrance, exit, dist);
  if (!path) return null;
  setPrice(path, dist.get(entrance)!);

  dist = buildDistanceMap(rooms, exit);
  path = buildPath(entrance, exit, dist);
  if (!path) return null;
  let room = entrance;
  for (const next of path) {
    connectRooms(room, next);
    room = next;
  }

  // The approach must not come from directly above the arena.
  const approach = exit.carvedTo[0];
  if (!approach || exit.t === approach.b) return null;

  for (const r of rooms) {
    if (r.type === RoomType.NULL && r.carvedTo.length > 0) r.type = RoomType.TUNNEL;
  }

  // Rat King room: unconnected neighbor on the arena's left, right, or south.
  const rkCands = exit.neighbours.filter(
    (r) =>
      !exit!.carvedTo.includes(r) &&
      (exit!.l === r.r || exit!.r === r.l || exit!.b === r.t),
  );
  if (rkCands.length > 0) {
    const rk = rng.pick(rkCands);
    connectRooms(rk, exit);
    rk.type = RoomType.RAT_KING;
  }

  return { entrance, exit, approach };
}

/** Random special pool order, per `Room.SPECIALS`. */
const SPECIALS_POOL = [
  RoomType.ARMORY,
  RoomType.WEAK_FLOOR,
  RoomType.MAGIC_WELL,
  RoomType.CRYPT,
  RoomType.POOL,
  RoomType.GARDEN,
  RoomType.LIBRARY,
  RoomType.TREASURY,
  RoomType.TRAPS,
  RoomType.STORAGE,
  RoomType.STATUE,
  RoomType.LABORATORY,
  RoomType.VAULT,
  RoomType.ALTAR,
];

const SPECIAL_SET = new Set(SPECIALS_POOL);

/**
 * Run-level special-room rotation (`Room.SPECIALS` / `shuffleTypes` /
 * `useType`). Call `resetSpecials(rng)` once per run (vanilla shuffles once
 * per run); `useSpecial` moves a used type to the back so unused types are
 * picked first.
 */
let specialsRotation: RoomType[] = [...SPECIALS_POOL];

export function resetSpecials(rng: RNG): void {
  specialsRotation = [...SPECIALS_POOL];
  // Vanilla shuffleTypes: Fisher-Yates over [i, size).
  for (let i = 0; i < specialsRotation.length - 1; i++) {
    const j = rng.int(i, specialsRotation.length);
    if (j !== i) {
      const t = specialsRotation[i]!;
      specialsRotation[i] = specialsRotation[j]!;
      specialsRotation[j] = t;
    }
  }
}

export function useSpecial(t: RoomType): void {
  const i = specialsRotation.indexOf(t);
  if (i >= 0) {
    specialsRotation.splice(i, 1);
    specialsRotation.push(t);
  }
}

export function currentSpecials(): RoomType[] {
  return [...specialsRotation];
}

export interface AssignOptions {
  prevWeakFloor: boolean;
  nextIsBoss: boolean;
}

export interface AssignResult {
  ok: boolean;
  /** A WEAK_FLOOR was placed: the next depth needs a PIT room. */
  weakFloor: boolean;
}

/**
 * Vanilla `RegularLevel.assignRoomType()`. Specials go to connected leaves
 * (1 connection, > 3 wide/high) with `Int(specialRooms^2 + 2) == 0` per
 * candidate; PIT chaining when the previous depth had a WEAK_FLOOR; forced
 * LABORATORY on depth%5==2; min-of-two pick from the per-level specials
 * copy with global `useType` rotation; failed leaves may gain an extra
 * connection; leftover NULL rooms become STANDARD (`Int(connections^2)==0`)
 * or TUNNEL; sealed rooms (0 connections) stay NULL.
 *
 * Vanilla iterates the rooms HashSet (arbitrary order); this port shuffles
 * the candidate leaves with the seeded RNG so the same seed always yields
 * the same assignment (documented in docs/DUNGEON-REPORT.md).
 */
export function assignRoomTypes(
  rng: RNG,
  rooms: Room[],
  depth: number,
  opts: AssignOptions,
): AssignResult {
  // Per-level copy of the global rotation; WEAK_FLOOR excluded before boss.
  const specials = currentSpecials();
  if (opts.nextIsBoss) {
    const i = specials.indexOf(RoomType.WEAK_FLOOR);
    if (i >= 0) specials.splice(i, 1);
  }
  const removeFromSpecials = (t: RoomType): void => {
    const i = specials.indexOf(t);
    if (i >= 0) specials.splice(i, 1);
  };

  let pitRoomNeeded = opts.prevWeakFloor;
  let weakFloorCreated = false;
  let specialRooms = 0;

  const leaves = rng.shuffle(rooms.filter((r) => r.type === RoomType.NULL));
  for (const r of leaves) {
    if (r.type !== RoomType.NULL || r.carvedTo.length !== 1) continue;

    if (specials.length > 0 && roomW(r) > 3 && roomH(r) > 3 && rng.int(0, specialRooms * specialRooms + 2) === 0) {
      if (pitRoomNeeded) {
        r.type = RoomType.PIT;
        pitRoomNeeded = false;
        for (const t of [
          RoomType.ARMORY,
          RoomType.CRYPT,
          RoomType.LABORATORY,
          RoomType.LIBRARY,
          RoomType.STATUE,
          RoomType.TREASURY,
          RoomType.VAULT,
          RoomType.WEAK_FLOOR,
        ]) {
          removeFromSpecials(t);
        }
      } else if (depth % 5 === 2 && specials.includes(RoomType.LABORATORY)) {
        r.type = RoomType.LABORATORY;
      } else {
        const n = specials.length;
        r.type = specials[Math.min(rng.int(0, n), rng.int(0, n))]!;
      }
      if (r.type === RoomType.WEAK_FLOOR) weakFloorCreated = true;
      useSpecial(r.type);
      removeFromSpecials(r.type);
      specialRooms++;
    } else if (rng.int(0, 2) === 0) {
      // Extra connection: leaf links one more non-special neighbor.
      const options = r.neighbours.filter(
        (n) => !r.carvedTo.includes(n) && !SPECIAL_SET.has(n.type) && n.type !== RoomType.PIT,
      );
      if (options.length > 1) {
        connectRooms(r, rng.pick(options));
      }
    }
  }

  // Remaining NULL rooms: STANDARD or TUNNEL (0-connection stays NULL).
  let count = 0;
  for (const r of rooms) {
    if (r.type !== RoomType.NULL) continue;
    const connections = r.carvedTo.length;
    if (connections === 0) {
      // sealed: stays NULL, never painted
    } else if (rng.int(0, connections * connections) === 0) {
      r.type = RoomType.STANDARD;
      count++;
    } else {
      r.type = RoomType.TUNNEL;
    }
  }

  // Force >= 4 STANDARD rooms (`randomRoom(TUNNEL, 1)` per iteration).
  let guard = 1000;
  while (count < 4 && guard-- > 0) {
    const r = rng.pick(rooms);
    if (r.type === RoomType.TUNNEL) {
      r.type = RoomType.STANDARD;
      count++;
    }
  }

  return { ok: true, weakFloor: weakFloorCreated };
}

/** Intersect rect of two rooms (inclusive bounds), or null when disjoint. */
export function intersectRooms(
  a: Room,
  b: Room,
): { l: number; t: number; r: number; b: number } | null {
  const l = Math.max(a.l, b.l);
  const t = Math.max(a.t, b.t);
  const r = Math.min(a.r, b.r);
  const bb = Math.min(a.b, b.b);
  if (l > r || t > bb) return null;
  return { l, t, r, b: bb };
}

/**
 * Vanilla `RegularLevel.placeDoors`: one shared Door per connected pair, on
 * the shared wall segment: `(i.left, Int(i.top+1, i.bottom))` for a vertical
 * shared edge, `(Int(i.left+1, i.right), i.top)` for a horizontal one.
 */
export function placeDoor(rng: RNG, a: Room, b: Room): Door | null {
  if (sharedDoor(a, b)) return sharedDoor(a, b)!;
  const w = intersectRooms(a, b);
  if (!w) return null;
  let door: Door;
  if (w.l === w.r) {
    door = { x: w.l, y: rng.int(w.t + 1, w.b), type: DoorType.EMPTY };
  } else {
    door = { x: rng.int(w.l + 1, w.r), y: w.t, type: DoorType.EMPTY };
  }
  a.doors.push(door);
  b.doors.push(door);
  return door;
}

/** The shared Door between two connected rooms, if any. */
export function sharedDoor(a: Room, b: Room): Door | undefined {
  return a.doors.find((d) => b.doors.includes(d));
}

/**
 * Vanilla `Room.entrance()`: the door to the first-connected neighbor.
 * (Vanilla read a HashMap in arbitrary order; carve order is deterministic.)
 */
export function entranceDoor(room: Room): Door | undefined {
  const n = room.carvedTo[0];
  return n ? sharedDoor(room, n) : undefined;
}

/**
 * Vanilla `RegularLevel.joinRooms`: STANDARD<->STANDARD pairs sharing enough
 * wall merge into an open passage (the door object stays but no tile is
 * painted). Returns the cells to carve as floor, or null when a door is
 * needed instead.
 */
export function joinRooms(a: Room, b: Room): { x: number; y: number }[] | null {
  if (a.type !== RoomType.STANDARD || b.type !== RoomType.STANDARD) return null;
  const w = intersectRooms(a, b);
  if (!w) return null;
  const cells: { x: number; y: number }[] = [];
  if (w.l === w.r) {
    if (w.b - w.t < 3) return null;
    if (w.b - w.t === Math.max(roomH(a), roomH(b))) return null;
    if (roomW(a) + roomW(b) > MAX_ROOM) return null;
    // Vanilla: w.top += 1; fill(w.left, w.top, 1, w.height(), EMPTY).
    for (let y = w.t + 1; y < w.b; y++) cells.push({ x: w.l, y });
  } else {
    if (w.r - w.l < 3) return null;
    if (w.r - w.l === Math.max(roomW(a), roomW(b))) return null;
    if (roomH(a) + roomH(b) > MAX_ROOM) return null;
    // Vanilla: w.left += 1; fill(w.left, w.top, w.width(), 1, EMPTY).
    for (let x = w.l + 1; x < w.r; x++) cells.push({ x, y: w.t });
  }
  return cells;
}
