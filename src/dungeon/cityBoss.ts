/**
 * City boss (Dwarf King) arena runtime behavior — the Level.press / Level.drop
 * overrides of CityBossLevel that cannot run at generation time.
 *
 * Ground truth: ~/workspace/pixel-dungeon-src
 * (levels/CityBossLevel.java, actors/mobs/Bestiary.java, actors/mobs/King.java).
 * Java wins every conflict.
 */
import { Terrain } from '../core/grid.js';
import type { RNG } from '../core/rng.js';
import type { Level } from './level.js';

/** Callbacks the arena-entry spawn needs from the content/engine layer. */
export interface CityArenaHooks {
  /**
   * True when another char already occupies the cell
   * (Actor.findChar(pos) != null). Vanilla's spawn loop does not check this
   * (CityBossLevel.java:199-207 only checks passable / outside / visible),
   * but the caller may pass () => false to stay byte-faithful; the hook
   * exists so the engine can avoid stacking on the hero.
   */
  occupied(pos: number): boolean;
  /**
   * Build the boss and add it to the scene: Bestiary.mob(depth) at depth 20
   * is the Dwarf King, state = HUNTING, GameScene.add (CityBossLevel.java:194-196).
   * Implemented by the caller because mob construction lives in the content
   * layer. The vanilla fade-in (boss.notice + AlphaTweener,
   * CityBossLevel.java:208-212) is a rendering concern owned by the caller.
   */
  spawn(pos: number): void;
}

/**
 * CityBossLevel.press, arena-entry portion (CityBossLevel.java:184-214).
 *
 * The first time the hero steps onto a cell OUTSIDE the entrance room — i.e.
 * any cell on a row above the arena door (`cell / WIDTH < arenaDoor / WIDTH`,
 * CityBossLevel.java:218-220) — the Dwarf King spawns on a random passable
 * cell also outside the entrance room, preferring non-visible cells for the
 * first 20 visible candidates, and the arena door is re-locked to LOCKED_DOOR
 * behind the hero.
 *
 * Callers invoke this for the hero's step only (ch == Dungeon.hero,
 * CityBossLevel.java:187); it is a no-op on levels without an arena door.
 */
export function pressArenaCell(
  level: Level,
  rng: RNG,
  cell: number,
  hooks: CityArenaHooks,
): void {
  if (level.enteredArena) return;
  if (level.arenaDoorCell < 0) return;
  const w = level.w;
  const doorRow = Math.floor(level.arenaDoorCell / w);
  // outsideEntraceRoom( cell ) (CityBossLevel.java:218-220)
  if (Math.floor(cell / w) >= doorRow) return;

  level.enteredArena = true;

  // do { boss.pos = Random.Int( LENGTH ); }
  // while ( !passable[boss.pos] ||
  //         !outsideEntraceRoom( boss.pos ) ||
  //         (Dungeon.visible[boss.pos] && count++ < 20) );
  // (CityBossLevel.java:199-207). Vanilla loops unbounded; the bounded retry
  // only gives up in a degenerate map, where spawning nothing is saner than
  // hanging. The visible-cell preference keeps the exact `count++ < 20`
  // gating: a visible cell is rejected only while fewer than 20 visible
  // candidates have been seen.
  let pos = -1;
  let count = 0;
  for (let tries = 0; tries < 4096 && pos < 0; tries++) {
    const p = rng.int(0, level.size);
    const px = p % w;
    const py = Math.floor(p / w);
    if (!level.isPassable(px, py)) continue;
    if (py >= doorRow) continue;
    if (level.visible[p] && count++ < 20) continue;
    if (hooks.occupied(p)) continue;
    pos = p;
  }
  if (pos >= 0) hooks.spawn(pos);

  // set( arenaDoor, Terrain.LOCKED_DOOR ); GameScene.updateMap( arenaDoor );
  // Dungeon.observe(); (CityBossLevel.java:210-213). Tile-art refresh and FOV
  // recompute are owned by the engine/renderer after the hero's turn.
  level.set(level.arenaDoorCell % w, doorRow, Terrain.DOOR_LOCKED);
}

/**
 * CityBossLevel.drop (CityBossLevel.java:198-212): the first SkeletonKey
 * dropped anywhere on the level turns the arena door into an ordinary door
 * (Terrain.DOOR), so the hero can leave after killing the King. Later drops
 * are plain drops.
 */
export function onItemDropped(level: Level, itemId: string): void {
  if (level.keyDropped) return;
  if (level.arenaDoorCell < 0) return;
  if (itemId !== 'skeleton_key') return;
  level.keyDropped = true;
  const w = level.w;
  level.set(
    level.arenaDoorCell % w,
    Math.floor(level.arenaDoorCell / w),
    Terrain.DOOR,
  );
}
