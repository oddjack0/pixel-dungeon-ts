/**
 * Prison boss (Tengu) arena runtime behavior — the Level.press / Level.drop
 * overrides of PrisonBossLevel that cannot run at generation time.
 *
 * Ground truth: ~/workspace/pixel-dungeon-src
 * (levels/PrisonBossLevel.java, actors/mobs/Tengu.java, actors/mobs/Bestiary.java).
 * Java wins every conflict.
 */
import { Terrain } from '../core/grid.js';
import type { RNG } from '../core/rng.js';
import type { Level } from './level.js';

/** Callbacks the arena-entry spawn needs from the content/engine layer. */
export interface ArenaSpawnHooks {
  /**
   * True when another char already occupies the cell
   * (Actor.findChar(pos) != null, PrisonBossLevel.java:312).
   */
  occupied(pos: number): boolean;
  /**
   * Build the boss and add it to the scene: Bestiary.mob(depth) at depth 10
   * is Tengu (Bestiary.java:107-110), state = HUNTING, GameScene.add, notice
   * yell, mobPress (PrisonBossLevel.java:316-323). Implemented by the caller
   * because mob construction lives in the content layer.
   */
  spawn(pos: number): void;
}

/**
 * PrisonBossLevel.press, arena-entry portion (PrisonBossLevel.java:303-328).
 *
 * The first time the hero steps onto a cell inside the arena (roomExit),
 * Tengu spawns at a random free arena cell (never the hero's cell), and the
 * arena door is re-locked to LOCKED_DOOR behind the hero.
 *
 * Callers invoke this for the hero's step only (ch == Dungeon.hero,
 * PrisonBossLevel.java:307); it is a no-op on levels without an arena.
 */
export function pressArenaCell(
  level: Level,
  rng: RNG,
  cell: number,
  hooks: ArenaSpawnHooks,
): void {
  if (level.enteredArena) return;
  const arena = level.bossArena;
  if (!arena) return;
  const w = level.w;
  const x = cell % w;
  const y = Math.floor(cell / w);
  // roomExit.inside( cell ) (PrisonBossLevel.java:307)
  if (x < arena.l || x > arena.r || y < arena.t || y > arena.b) return;

  level.enteredArena = true;

  // do { pos = roomExit.random(); }
  // while (pos == cell || Actor.findChar( pos ) != null);
  // (PrisonBossLevel.java:309-312). Room.random(0) draws interior cells only
  // (Room.java:101-105), so the spawn can never be a wall.
  let pos = -1;
  for (let tries = 0; tries < 64 && pos < 0; tries++) {
    const px = arena.l + 1 + rng.int(0, arena.r - arena.l - 1);
    const py = arena.t + 1 + rng.int(0, arena.b - arena.t - 1);
    const p = py * w + px;
    if (p !== cell && !hooks.occupied(p)) pos = p;
  }
  if (pos >= 0) hooks.spawn(pos);
  // (Vanilla loops until it finds a cell; the bounded retry only gives up in
  // a degenerate full arena, where spawning nothing is saner than hanging.)

  // set( arenaDoor, Terrain.LOCKED_DOOR ); GameScene.updateMap( arenaDoor );
  // Dungeon.observe(); (PrisonBossLevel.java:324-326). Tile-art refresh and
  // FOV recompute are owned by the engine/renderer after the hero's turn.
  if (level.arenaDoorCell >= 0) {
    level.set(
      level.arenaDoorCell % w,
      Math.floor(level.arenaDoorCell / w),
      Terrain.DOOR_LOCKED,
    );
  }
}

/**
 * PrisonBossLevel.drop (PrisonBossLevel.java:331-343): the first SkeletonKey
 * dropped anywhere on the level turns the arena door into an ordinary door
 * (Terrain.DOOR), so the hero can leave after killing Tengu. Later drops are
 * plain drops.
 */
export function onItemDropped(level: Level, itemId: string): void {
  if (level.keyDropped || !level.bossArena) return;
  if (itemId !== 'skeleton_key') return;
  level.keyDropped = true;
  if (level.arenaDoorCell >= 0) {
    const w = level.w;
    level.set(
      level.arenaDoorCell % w,
      Math.floor(level.arenaDoorCell / w),
      Terrain.DOOR,
    );
  }
}
