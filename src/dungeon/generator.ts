import { Terrain, Feeling, regionForDepth } from '../core/grid.js';
import { Grid } from '../core/grid.js';
import type { RNG } from '../core/rng.js';
import { computeFov } from '../core/fov.js';
import { Level, type HeapKind, type ItemSpawn, type MobSpawn, type LevelGen } from './level.js';
import { newRunState, type RunState } from './level.js';
import {
  DoorType,
  RoomType,
  buildRooms,
  planConnections,
  planBossConnections,
  planPrisonBossConnections,
  assignRoomTypes,
  resetSpecials,
  entranceDoor,
  roomW,
  roomH,
  type Room,
} from './rooms.js';
import {
  PainterCtx,
  paintRooms,
  paintWaterGrass,
  paintDoorTiles,
  paintPrisonBossDoors,
  placeTraps,
  placePoisonTraps,
  decorateSewers,
  decorateBoss,
  decoratePrison,
  decoratePrisonBoss,
  decorateCaves,
  paintCavesBoss,
  placeSign,
  randomCell,
  type SpawnKind,
  type PainterMarkers,
} from './painters.js';
import { paintShopRoom } from './shopPainter.js';

/**
 * Milestone 1 dungeon generator: Sewers depths 1-4 + the Goo boss level
 * (depth 5), Prison depths 6-9 + the Tengu boss level (depth 10), Caves
 * depths 11-14 + the DM-300 boss level (depth 15).
 * Follows vanilla `Level.create()`:
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

/**
 * Vanilla `Dungeon.bossLevel(depth)` (Dungeon.java:241-243): every 5th depth.
 */
export function isBossDepth(depth: number): boolean {
  return depth % 5 === 0;
}

/**
 * Vanilla `Dungeon.shopOnLevel()` (Dungeon.java:241-243): depths 6, 11, 16.
 * (ShopPainter has an unreachable depth-21 case; the shop never generates
 * there in vanilla.)
 */
export function shopOnLevel(depth: number): boolean {
  return depth === 6 || depth === 11 || depth === 16;
}

/** Prison region depths (6-10), where PrisonLevel/PrisonBossLevel rules apply. */
export function isPrisonDepth(depth: number): boolean {
  return depth >= 6 && depth <= 10;
}

/** Caves regular depths (11-14), where CavesLevel rules apply. */
export function isCavesDepth(depth: number): boolean {
  return depth >= 11 && depth <= 14;
}

/**
 * Vanilla `RegularLevel.build` shop selection: a room directly connected to
 * the entrance, with exactly one connection, at least 5x5 (width()/height()).
 * Null when none qualifies (vanilla `return false` → rebuild).
 */
function findShopRoom(entrance: Room): Room | null {
  for (const r of entrance.carvedTo) {
    if (r.carvedTo.length === 1 && roomW(r) >= 5 && roomH(r) >= 5) return r;
  }
  return null;
}

// RunState/newRunState live in level.ts (the engine threads one per run).
export { newRunState, type RunState };

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

export function generateLevel(rng: RNG, depth: number, run: RunState): GenResult {
  const boss = isBossDepth(depth);
  const tengu = depth === 10;
  const dm300 = depth === 15;

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
      // Vanilla Level.java:179: no chasm feeling right before a boss depth.
      if (!isBossDepth(depth + 1)) feeling = Feeling.CHASM;
    } else if (r === 1) {
      feeling = Feeling.WATER;
    } else if (r === 2) {
      feeling = Feeling.GRASS;
    }
  }

  // ---- 3. build ----
  let rooms: Room[] = [];
  let entranceRoom: Room | null = null;
  let exitRoom: Room | null = null;
  /** Tengu level: the room before the arena (holds the iron-key chest). */
  let anteroom: Room | null = null;
  let ctx: PainterCtx | null = null;
  let entranceCell = -1;
  let exitCell = -1;
  /** DM-300 level: the arena-door cell (CavesBossLevel.arenaDoor). */
  let cavesArenaDoor = -1;
  /** DM-300 level: the arena bounds (bossArena seam). */
  let cavesArena: { l: number; t: number; r: number; b: number } | null = null;
  let secretDoors = 0;
  let trapAttempts = 0;
  let trapsPlaced = 0;
  const pitNeeded = depth > 1 && run.weakFloor;

  if (dm300) {
    // Vanilla `CavesBossLevel.build` + `decorate`
    // (CavesBossLevel.java:81-176): no room system — 8 carved chambers plus
    // the DM-300 arena. No feeling, no placeTraps, no quest items
    // (CavesBossLevel extends Level directly, not RegularLevel). Single-shot:
    // the carve has no failure modes, so no retry loop is needed.
    const c = new PainterCtx(rng, W, H, depth, 'none', true, false);
    const built = paintCavesBoss(c);
    entranceCell = built.entrance;
    exitCell = built.exit;
    cavesArenaDoor = built.arenaDoor;
    cavesArena = built.arena;
    rooms = [];
    ctx = c;
  } else
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
      !boss && isBossDepth(depth + 1),
    );
    c.out.spawnQueue.push(...queue);

    if (boss) {
      if (tengu) {
        // Vanilla `PrisonBossLevel.build` (PrisonBossLevel.java:89-165).
        const plan = planPrisonBossConnections(rng, built);
        if (!plan) continue;
        entranceRoom = plan.entrance;
        exitRoom = plan.exit;
        anteroom = plan.anteroom;
        const painted = paintRooms(c, built);
        entranceCell = painted.entrance;
        exitCell = painted.exit;
        if (entranceCell < 0 || exitCell < 0) continue;
        // Vanilla PrisonBossLevel.build:158-161 — the approach may not enter
        // through the arena's top wall.
        const arenaDoor = entranceDoor(exitRoom);
        if (arenaDoor && arenaDoor.y === exitRoom.t) continue;
        secretDoors = paintPrisonBossDoors(c, built, exitRoom, arenaDoor ?? null);
        // Vanilla `PrisonBossLevel.water/grass` (PrisonBossLevel.java:167-173).
        paintWaterGrass(c, built, 0.45, 0.3);
        const traps = placePoisonTraps(c, built);
        trapAttempts = traps.attempts;
        trapsPlaced = traps.placed;
        decoratePrisonBoss(c, entranceRoom, entranceCell, exitRoom);
      } else {
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
      }
    } else {
      const plan = planConnections(rng, built, {
        exitMinSize: 4,
        exitType: RoomType.EXIT,
        connectFirstPath: true,
        fillRandom: true,
      });
      if (!plan) continue;
      // Vanilla `RegularLevel.build`: the shop room is picked before
      // `assignRoomType` (RegularLevel.java); no qualifying room → rebuild.
      if (shopOnLevel(depth)) {
        const shop = findShopRoom(plan.entrance);
        if (!shop) continue;
        shop.type = RoomType.SHOP;
      }
      const assign = assignRoomTypes(rng, built, depth, {
        prevWeakFloor: pitNeeded,
        nextIsBoss: isBossDepth(depth + 1),
        tunnelsToPassages: isPrisonDepth(depth),
      });
      run.weakFloor = assign.weakFloor;
      // Vanilla `Blacksmith.Quest.spawn` (Blacksmith.java:305-320), called
      // from `CavesLevel.assignRoomType` (CavesLevel.java:62-66): once per
      // run, on depths 12-14 with `Int(15-depth)==0` (depth 14: guaranteed).
      // The first STANDARD room bigger than 4x4 becomes the blacksmith's
      // room. (Vanilla iterates a HashSet; `built` order is this port's
      // deterministic stand-in — see docs/DUNGEON-REPORT.md.)
      if (
        isCavesDepth(depth) &&
        depth > 11 &&
        !run.blacksmithSpawned &&
        rng.int(0, 15 - depth) === 0
      ) {
        for (const r of built) {
          if (r.type === RoomType.STANDARD && roomW(r) > 4 && roomH(r) > 4) {
            r.type = RoomType.BLACKSMITH;
            run.blacksmithSpawned = true;
            break;
          }
        }
      }
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
      if (isPrisonDepth(depth)) {
        // Vanilla `PrisonLevel.water/grass` (PrisonLevel.java:132-138).
        paintWaterGrass(
          c,
          built,
          feeling === Feeling.WATER ? 0.65 : 0.45,
          feeling === Feeling.GRASS ? 0.6 : 0.4,
          4,
          3,
        );
        decoratePrison(c, entranceRoom, entranceCell);
      } else if (isCavesDepth(depth)) {
        // Vanilla `CavesLevel.water/grass` (CavesLevel.java:53-59).
        paintWaterGrass(
          c,
          built,
          feeling === Feeling.WATER ? 0.6 : 0.45,
          feeling === Feeling.GRASS ? 0.55 : 0.35,
          6,
          3,
        );
        decorateCaves(c, built, entranceRoom, entranceCell);
      } else {
        paintWaterGrass(c, built);
        decorateSewers(c, entranceRoom, entranceCell);
      }
    }

    rooms = built;
    ctx = c;
    break;
  }
  if (!ctx || entranceCell < 0 || exitCell < 0) {
    throw new Error(`dungeon generation failed for depth ${depth}`);
  }
  // DM-300 depths use no rooms; every other depth has entrance/exit rooms.
  if (!dm300 && (!entranceRoom || !exitRoom)) {
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
    // Tengu is NOT generated: he spawns when the hero enters the arena
    // (PrisonBossLevel.press) — the boss worker's runtime hook. DM-300 is
    // NOT generated either: it spawns when the hero LEAVES the arena
    // (CavesBossLevel.press) — see cavesBoss.ts.
    if (!tengu && !dm300 && exitRoom) mobs.push({ pos: randomCell(ctx, exitRoom), kind: 'boss' });
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
    // Sewers only: the hook lives in SewerLevel, so depths 2-4.
    if (!run.ghostSpawned && depth > 1 && depth < 5 && rng.int(0, 5 - depth) === 0) {
      let pos = -1;
      for (let t = 0; t < 50 && pos === -1; t++) pos = randomRespawnCell();
      if (pos !== -1) {
        occupied.add(pos);
        mobs.push({ pos, kind: 'ghost' });
        run.ghostSpawned = true;
      }
    }
    // The old wandmaker (PrisonLevel.createMobs -> Wandmaker.Quest.spawn),
    // once per run, only on depths 7-9 (Wandmaker.java:182-193): chance
    // Random.Int(10-depth)==0, placed in the entrance room but never on the
    // entrance tile or the sign.
    if (!run.wandmakerSpawned && depth > 6 && depth < 10 && rng.int(0, 10 - depth) === 0) {
      for (let t = 0; t < 50; t++) {
        // Non-boss depths always have an entrance room here (checked above).
        const pos = randomCell(ctx, entranceRoom!);
        if (tiles[pos] === Terrain.ENTRANCE) continue;
        if (ctx.out.markers.signs.includes(pos)) continue;
        if (occupied.has(pos)) continue;
        occupied.add(pos);
        mobs.push({ pos, kind: 'wandmaker' });
        run.wandmakerSpawned = true;
        break;
      }
    }
  }

  // ---- 5b. createItems ----
  const items: ItemSpawn[] = [...ctx.out.items];

  if (boss) {
    if (tengu && anteroom) {
      // Vanilla `PrisonBossLevel.createItems` (PrisonBossLevel.java:253-262):
      // the iron key for the arena door drops as a chest heap on a random
      // passable anteroom cell. (Bones.get() is skipped: no cross-run bone
      // state in M1 — see report.)
      let keyPos = -1;
      for (let t = 0; t < 1000 && keyPos < 0; t++) {
        const p = randomCell(ctx, anteroom);
        if (PASSABLE_SPAWN.has(tiles[p]!)) keyPos = p;
      }
      if (keyPos < 0) {
        // Guaranteed fallback: the anteroom interior is floor, so this only
        // fires if every interior cell grew a trap.
        for (let y = anteroom.t + 1; y < anteroom.b && keyPos < 0; y++) {
          for (let x = anteroom.l + 1; x < anteroom.r && keyPos < 0; x++) {
            if (tiles[y * W + x] === Terrain.FLOOR) keyPos = y * W + x;
          }
        }
      }
      if (keyPos >= 0) items.push({ pos: keyPos, heap: 'CHEST', tag: 'iron-key' });
    }
  } else {
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
    // Sewers only (depths 1-4): the hook lives in SewerLevel.createItems.
    if (run.dewVialNeeded && depth < 5 && rng.int(0, 4 - depth) === 0) {
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
  if (tengu && exitRoom) {
    // Runtime seam for the boss worker's Tengu arena-entry hook
    // (PrisonBossLevel.press/seal/unseal).
    level.bossArena = { l: exitRoom.l, t: exitRoom.t, r: exitRoom.r, b: exitRoom.b };
    const arenaDoor = entranceDoor(exitRoom);
    level.arenaDoorCell = arenaDoor ? ctx.idx(arenaDoor.x, arenaDoor.y) : -1;
  }
  if (dm300 && cavesArena) {
    // Runtime seam for the boss worker's DM-300 arena-exit hook
    // (CavesBossLevel.press/seal/unseal — see cavesBoss.ts).
    level.bossArena = { ...cavesArena };
    level.arenaDoorCell = cavesArenaDoor;
  }

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
 * contract. The engine threads its per-run RunState so once-per-run quests
 * stay consistent across depths (a fresh state is used only when the caller
 * passes none, e.g. unit tests).
 */
export const sewersLevelGen: LevelGen = {
  generate(rng: RNG, depth: number, run?: RunState): Level {
    return generateLevel(rng, depth, run ?? newRunState()).level;
  },
};
