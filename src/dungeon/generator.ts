import { Terrain, Feeling, regionForDepth } from '../core/grid.js';
import { Grid } from '../core/grid.js';
import type { RNG } from '../core/rng.js';
import { computeFov } from '../core/fov.js';
import { Level, type HeapKind, type ItemSpawn, type MobSpawn, type LevelGen } from './level.js';
import {
  DoorType,
  RoomType,
  buildRooms,
  planConnections,
  planBossConnections,
  assignRoomTypes,
  resetSpecials,
  type Room,
} from './rooms.js';
import {
  PainterCtx,
  paintRooms,
  paintWaterGrass,
  paintDoorTiles,
  placeTraps,
  decorateSewers,
  decorateBoss,
  placeSign,
  randomCell,
  type SpawnKind,
  type PainterMarkers,
} from './painters.js';

/**
 * Milestone 1 dungeon generator: Sewers depths 1-4 + the Goo boss level
 * (depth 5). Follows vanilla `Level.create()`:
 *
 *  1. quest items queued (`addItemToSpawn`) — skipped on boss levels
 *  2. feeling roll (depth > 1, never on boss levels)
 *  3. build retry loop (`buildRooms` -> plan -> assign -> paint)
 *  4. water/grass patches, traps, `decorate()`
 *  5. `createMobs()` / `createItems()`
 *
 * Every random choice uses the passed-in seeded RNG, so the same seed
 * always produces the same level.
 */

/** Per-run state (vanilla `Dungeon` statics that cross depths). */
export interface RunState {
  /** A WEAK_FLOOR was placed on the previous depth: this depth needs a PIT. */
  weakFloor: boolean;
  /** The sad ghost has spawned already (once per run). */
  ghostSpawned: boolean;
  /** The hero still needs a dew vial (once per run). */
  dewVialNeeded: boolean;
  /** Scrolls of Upgrade generated so far (vanilla `Dungeon.scrollsOfUpgrade`). */
  scrollsOfUpgrade: number;
}

export function newRunState(): RunState {
  return { weakFloor: false, ghostSpawned: false, dewVialNeeded: true, scrollsOfUpgrade: 0 };
}

export interface GenResult {
  level: Level;
  rooms: Room[];
  markers: PainterMarkers;
  /** Item spawn points for the content designer (Level.items stays empty). */
  items: ItemSpawn[];
  /** Mob spawn points for the content designer (Level.mobs stays empty). */
  mobs: MobSpawn[];
  /** Vanilla `placeTraps` attempt count (depth 1: 0, else in [1, rooms+depth)). */
  trapAttempts: number;
  /** Traps actually placed by `placeTraps` (<= attempts). */
  trapsPlaced: number;
}

const W = 32;
const H = 32;

const questItem = (tag: string): SpawnKind => ({ tag, heap: 'HEAP' });

function feelingName(f: Feeling): 'none' | 'water' | 'grass' | 'chasm' {
  switch (f) {
    case Feeling.WATER:
      return 'water';
    case Feeling.GRASS:
      return 'grass';
    case Feeling.CHASM:
      return 'chasm';
    default:
      return 'none';
  }
}

/** Tiles that block line of sight for the spawn-visibility check. */
function blocksSight(t: Terrain): boolean {
  return (
    t === Terrain.WALL ||
    t === Terrain.DOOR ||
    t === Terrain.DOOR_SECRET ||
    t === Terrain.DOOR_LOCKED ||
    t === Terrain.BARRICADE ||
    t === Terrain.BOOKSHELF ||
    t === Terrain.STATUE
  );
}

const PASSABLE_SPAWN = new Set<Terrain>([
  Terrain.FLOOR,
  Terrain.WALKWAY,
  Terrain.GRASS,
  Terrain.HIGH_GRASS,
  Terrain.EMBERS,
  Terrain.WATER,
  Terrain.DOOR,
  Terrain.DOOR_SECRET,
  Terrain.ENTRANCE,
  Terrain.EXIT,
]);

/** True when a painted door tile is an actual door (not an open passage). */
function isDoorTile(tile: Terrain): boolean {
  return (
    tile === Terrain.DOOR ||
    tile === Terrain.DOOR_SECRET ||
    tile === Terrain.DOOR_LOCKED ||
    tile === Terrain.BARRICADE ||
    tile === Terrain.BOOKSHELF
  );
}

/**
 * Vanilla `Dungeon.souNeeded()` (Dungeon.java:288-291) with
 * `chance(quota, number)` (Dungeon.java:297-306).
 */
function souNeeded(rng: RNG, depth: number, scrolls: number): boolean {
  const quota = [5, 3, 10, 6, 15, 9, 20, 12, 25, 13];
  for (let i = 0; i < quota.length; i += 2) {
    const qDepth = quota[i]!;
    if (depth <= qDepth) {
      const qNumber = quota[i + 1]!;
      return rng.float(0, 1) < (qNumber - scrolls) / (qDepth - depth + 1);
    }
  }
  return false;
}

export function generateLevel(rng: RNG, depth: number, run: RunState): GenResult {  const boss = depth === 5;

  // ---- 1. quest items (Level.create; skipped on boss levels) ----
  const queue: SpawnKind[] = [];
  if (!boss) {
    queue.push(questItem('food'));
    // Vanilla Level.create (Level.java:161-174): three INDEPENDENT checks.
    // (M1 keeps the repo's existing depth%5 triggers for strength/enchantment;
    // only the upgrade scroll uses the faithful souNeeded quota.)
    if (depth % 5 === 1) queue.push(questItem('potion-of-strength'));
    if (depth % 5 === 3) queue.push(questItem('scroll-of-enchantment'));
    // Vanilla `Dungeon.souNeeded()` (Dungeon.java:288-291): quota-driven
    // chance per depth, not a fixed schedule. Lands ~2-3 scrolls of upgrade
    // across depths 1-5 (depth 1 eligible at 3/5 when none generated yet).
    if (souNeeded(rng, depth, run.scrollsOfUpgrade)) {
      queue.push(questItem('scroll-of-upgrade'));
      run.scrollsOfUpgrade++;
    }
  }

  // ---- 2. feeling (depth > 1, never on boss levels) ----
  let feeling: Feeling = Feeling.NONE;
  if (!boss && depth > 1) {
    const r = rng.int(0, 10);
    if (r === 0) {
      if (depth + 1 !== 5) feeling = Feeling.CHASM;
    } else if (r === 1) {
      feeling = Feeling.WATER;
    } else if (r === 2) {
      feeling = Feeling.GRASS;
    }
  }

  // ---- 3. build retry loop ----
  let rooms: Room[] = [];
  let entranceRoom: Room | null = null;
  let exitRoom: Room | null = null;
  let ctx: PainterCtx | null = null;
  let entranceCell = -1;
  let exitCell = -1;
  let secretDoors = 0;
  let trapAttempts = 0;
  let trapsPlaced = 0;
  const pitNeeded = depth > 1 && run.weakFloor;

  for (let attempt = 0; attempt < 200; attempt++) {
    const built = buildRooms(rng);
    if (!built) continue;

    const c = new PainterCtx(
      rng,
      W,
      H,
      depth,
      feelingName(feeling),
      boss,
      !boss && depth + 1 === 5,
    );
    c.out.spawnQueue.push(...queue);

    if (boss) {
      const plan = planBossConnections(rng, built);
      if (!plan) continue;
      entranceRoom = plan.entrance;
      exitRoom = plan.exit;
      const painted = paintRooms(c, built);
      entranceCell = painted.entrance;
      exitCell = painted.exit;
      if (entranceCell < 0 || exitCell < 0) continue;
      secretDoors = paintDoorTiles(c, built);
      paintWaterGrass(c, built, 0.5, 0.4);
      const traps = placeTraps(c, built);
      trapAttempts = traps.attempts;
      trapsPlaced = traps.placed;
      decorateBoss(c, exitRoom, exitCell);
      placeSign(c, entranceRoom, entranceCell);
    } else {
      const plan = planConnections(rng, built, {
        exitMinSize: 4,
        exitType: RoomType.EXIT,
        connectFirstPath: true,
        fillRandom: true,
      });
      if (!plan) continue;
      const assign = assignRoomTypes(rng, built, depth, {
        prevWeakFloor: pitNeeded,
        nextIsBoss: depth + 1 === 5,
      });
      run.weakFloor = assign.weakFloor;
      entranceRoom = plan.entrance;
      exitRoom = plan.exit;
      // CHASM feeling: the unpainted map is chasm (Level.create).
      if (feeling === Feeling.CHASM) c.tiles.fill(Terrain.CHASM);
      const painted = paintRooms(c, built);
      entranceCell = painted.entrance;
      exitCell = painted.exit;
      if (entranceCell < 0 || exitCell < 0) continue;
      secretDoors = paintDoorTiles(c, built);
      const traps = placeTraps(c, built);
      trapAttempts = traps.attempts;
      trapsPlaced = traps.placed;
      paintWaterGrass(c, built);
      decorateSewers(c, entranceRoom, entranceCell);
    }

    rooms = built;
    ctx = c;
    break;
  }
  if (!ctx || !entranceRoom || !exitRoom || entranceCell < 0 || exitCell < 0) {
    throw new Error(`dungeon generation failed for depth ${depth}`);
  }

  const tiles = ctx.tiles;

  // ---- 5a. createMobs ----
  const mobs: MobSpawn[] = [...ctx.out.mobs];
  const occupied = new Set<number>([entranceCell]);
  for (const m of mobs) occupied.add(m.pos);

  // Vanilla `!Dungeon.visible[cell]`: the hero stands on the entrance tile.
  const grid = new Grid(W, H);
  const visible = new Uint8Array(W * H);
  computeFov(
    grid,
    (x, y) => blocksSight(tiles[y * W + x]!),
    entranceCell % W,
    Math.floor(entranceCell / W),
    8,
    visible,
  );

  const randomStandardRoom = (): Room | null => {
    for (let i = 0; i < 10; i++) {
      const r = rng.pick(rooms);
      if (r.type === RoomType.STANDARD) return r;
    }
    return null;
  };

  const randomRespawnCell = (): number => {
    for (let i = 0; i < 10; i++) {
      const room = randomStandardRoom();
      if (!room) continue;
      const cell = randomCell(ctx, room);
      if (!visible[cell] && !occupied.has(cell) && PASSABLE_SPAWN.has(tiles[cell]!)) {
        return cell;
      }
    }
    return -1;
  };

  if (boss) {
    // Vanilla `SewerBossLevel.createMobs`: exactly one Bestiary mob (Goo).
    mobs.push({ pos: randomCell(ctx, exitRoom), kind: 'boss' });
  } else {
    const nMobs = 2 + (depth % 5) + rng.int(0, 3);
    for (let i = 0; i < nMobs; i++) {
      let pos = -1;
      for (let t = 0; t < 50 && pos === -1; t++) pos = randomRespawnCell();
      if (pos === -1) continue;
      occupied.add(pos);
      // Vanilla `Bestiary.mob(depth)`; the content designer resolves it.
      mobs.push({ pos, kind: 'mob' });
    }
    // The sad ghost (SewerLevel.createMobs -> Ghost.Quest.spawn), once/run.
    if (!run.ghostSpawned && depth > 1 && rng.int(0, 5 - depth) === 0) {
      let pos = -1;
      for (let t = 0; t < 50 && pos === -1; t++) pos = randomRespawnCell();
      if (pos !== -1) {
        occupied.add(pos);
        mobs.push({ pos, kind: 'ghost' });
        run.ghostSpawned = true;
      }
    }
  }

  // ---- 5b. createItems ----
  const items: ItemSpawn[] = [...ctx.out.items];

  if (!boss) {
    // unlockedOnly: guaranteed quest items (food, potion of strength,
    // scrolls of upgrade, dew vial) must always be obtainable — vanilla
    // never strands them behind a locked door whose key is unreachable.
    const randomDropCell = (unlockedOnly = false, walkableOnly = false): number => {
      for (let guard = 0; guard < 1000; guard++) {
        const room = randomStandardRoom();
        if (!room) continue;
        if (
          unlockedOnly &&
          room.doors.some((d) => d.type === DoorType.LOCKED)
        )
          continue;
        const pos = randomCell(ctx, room);
        const t = tiles[pos]!;
        if (!PASSABLE_SPAWN.has(t)) continue;
        // Vanilla `Level.passable[]` treats water as walkable, so the
        // walkableOnly filter here is about standard-room floor tiles —
        // quest items must land where the hero can actually pick them up.
        if (walkableOnly && t === Terrain.WATER) continue;
        return pos;
      }
      throw new Error('randomDropCell failed: no standard room');
    };

    let nItems = 3;
    while (rng.float(0, 1) < 0.4) nItems++;
    for (let i = 0; i < nItems; i++) {
      let heap: HeapKind;
      switch (rng.int(0, 20)) {
        case 0:
          heap = 'SKELETON';
          break;
        case 1:
        case 2:
        case 3:
        case 4:
          heap = 'CHEST';
          break;
        case 5:
          heap = depth > 1 ? 'MIMIC' : 'CHEST';
          break;
        default:
          heap = 'HEAP';
          break;
      }
      items.push({ pos: randomDropCell(false, true), heap, tag: 'random' });
    }

    // SewerLevel.createItems: the dew vial joins the spawn queue (once/run).
    if (run.dewVialNeeded && rng.int(0, 4 - depth) === 0) {
      ctx.out.spawnQueue.push(questItem('dew-vial'));
      run.dewVialNeeded = false;
    }

    for (const queued of ctx.out.spawnQueue) {
      let cell = randomDropCell(true, true);
      if (queued.tag === 'scroll-of-upgrade') {
        let guard = 1000;
        while (
          (tiles[cell] === Terrain.TRAP_FIRE || tiles[cell] === Terrain.TRAP_FIRE_HIDDEN) &&
          guard-- > 0
        ) {
          cell = randomDropCell(true, true);
        }
      }
      items.push({ pos: cell, heap: queued.heap, tag: queued.tag });
    }
  }
  // (Bones.get() is skipped: no cross-run bone state in M1 — see report.)

  // ---- assemble the Level model ----
  const level = new Level(W, H);
  level.depth = depth;
  level.region = regionForDepth(depth);
  level.tiles = tiles;
  level.feeling = feeling;
  level.bossLevel = boss;
  level.sealed = false;
  level.secretDoors = secretDoors;
  level.stairsUp = entranceCell;
  level.stairsDown = exitCell;
  level.doors = ctx.out.doors.flatMap((d) => (isDoorTile(d.tile) ? [ctx.idx(d.x, d.y)] : []));
  level.traps = ctx.out.traps.map((t) => ctx.idx(t.x, t.y));

  return { level, rooms, markers: ctx.out.markers, items, mobs, trapAttempts, trapsPlaced };
}

/**
 * Generate a full M1 run's dungeons (depths 1-5) with one RNG stream.
 * Resets the special-room rotation once, as vanilla shuffles it per run.
 */
export function generateRun(rng: RNG): GenResult[] {
  resetSpecials(rng);
  const run = newRunState();
  const out: GenResult[] = [];
  for (let depth = 1; depth <= 5; depth++) {
    out.push(generateLevel(rng, depth, run));
  }
  return out;
}

/**
 * SEAM adapter: standalone per-depth generation for the engine's LevelGen
 * contract. Note: cross-depth run state (weak-floor chaining, ghost, dew
 * vial) only stays consistent when depths are generated via `generateRun`.
 */
export const sewersLevelGen: LevelGen = {
  generate(rng: RNG, depth: number): Level {
    return generateLevel(rng, depth, newRunState()).level;
  },
};
