/**
 * Caves boss (DM-300) arena runtime behavior — the Level.press / Level.drop
 * overrides of CavesBossLevel that cannot run at generation time.
 *
 * Ground truth: ~/workspace/pixel-dungeon-src
 * (levels/CavesBossLevel.java, actors/mobs/DM300.java, actors/mobs/Bestiary.java).
 * Java wins every conflict.
 */
import { Terrain } from '../core/grid.js';
import type { RNG } from '../core/rng.js';
import type { Level } from './level.js';

/** Callbacks the arena-exit spawn needs from the content/engine layer. */
export interface CavesArenaHooks {
  /**
   * True when another char already occupies the cell
   * (Actor.findChar(pos) != null). Vanilla's spawn loop does not check
   * this (CavesBossLevel.java:202-207 only checks passable / outside /
   * visible), but the caller may pass () => false to stay byte-faithful;
   * the hook exists so the engine can avoid stacking on the hero.
   */
  occupied(pos: number): boolean;
  /**
   * Build the boss and add it to the scene: Bestiary.mob(depth) at depth 15
   * is DM-300, state = HUNTING, GameScene.add (CavesBossLevel.java:199-201).
   * Implemented by the caller because mob construction lives in the
   * content layer.
   */
  spawn(pos: number): void;
}

/**
 * CavesBossLevel.press, arena-exit portion (CavesBossLevel.java:184-214).
 *
 * Unlike the Tengu arena (which triggers on entry), DM-300 spawns the first
 * time the hero steps OUTSIDE the entrance room (the arena): the hero
 * descends INTO the arena, and leaving it wakes DM-300, which appears on a
 * random passable, non-visible cell outside the arena. The arena door is
 * then sealed to WALL behind the hero.
 *
 * Callers invoke this for the hero's step only (ch == Dungeon.hero,
 * CavesBossLevel.java:187); it is a no-op on levels without an arena.
 */
export function pressArenaCell(
  level: Level,
  rng: RNG,
  cell: number,
  hooks: CavesArenaHooks,
): void {
  if (level.enteredArena) return;
  const arena = level.bossArena;
  if (!arena) return;
  const w = level.w;
  const x = cell % w;
  const y = Math.floor(cell / w);
  // outsideEntraceRoom( cell ) (CavesBossLevel.java:247-252)
  const outside =
    x < arena.l - 1 || x > arena.r + 1 || y < arena.t - 1 || y > arena.b + 1;
  if (!outside) return;

  level.enteredArena = true;

  // do { boss.pos = Random.Int( LENGTH ); }
  // while ( !passable[boss.pos] ||
  //         !outsideEntraceRoom( boss.pos ) ||
  //         Dungeon.visible[boss.pos] );
  // (CavesBossLevel.java:202-207). Vanilla loops unbounded; the bounded
  // retry only gives up in a degenerate map, where spawning nothing is
  // saner than hanging.
  let pos = -1;
  for (let tries = 0; tries < 4096 && pos < 0; tries++) {
    const p = rng.int(0, level.size);
    const px = p % w;
    const py = Math.floor(p / w);
    const pOutside =
      px < arena.l - 1 || px > arena.r + 1 || py < arena.t - 1 || py > arena.b + 1;
    if (pOutside && level.isPassable(px, py) && !level.visible[p] && !hooks.occupied(p)) {
      pos = p;
    }
  }
  if (pos >= 0) hooks.spawn(pos);

  // set( arenaDoor, Terrain.WALL ); GameScene.updateMap( arenaDoor );
  // Dungeon.observe(); (CavesBossLevel.java:211-213). Tile-art refresh and
  // FOV recompute are owned by the engine/renderer after the hero's turn.
  if (level.arenaDoorCell >= 0) {
    level.set(
      level.arenaDoorCell % w,
      Math.floor(level.arenaDoorCell / w),
      Terrain.WALL,
    );
  }
}

/**
 * CavesBossLevel.drop (CavesBossLevel.java:217-231): the first SkeletonKey
 * dropped anywhere on the level unseals the arena door — vanilla sets
 * EMPTY_DECO, which is passable floor; this port's Terrain contract has no
 * EMPTY_DECO id, so FLOOR is stored. Later drops are plain drops.
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
      Terrain.FLOOR,
    );
  }
}
