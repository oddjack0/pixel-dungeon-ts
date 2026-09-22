import { Grid, Terrain, Region, Feeling, regionForDepth, isHiddenTrap, revealTrapTile, trapName } from '../core/grid.js';
import { computeFov } from '../core/fov.js';
import type { RNG } from '../core/rng.js';
import type { Blob } from '../mechanics/blobs.js';

export { regionForDepth };

/**
 * Level model (SPEC contract §3). Canonical shape:
 * { depth, region, width, height, tiles, explored, stairsUp, stairsDown,
 *   doors, traps, items, mobs }.
 *
 * The engine reads: tiles, explored, visible, stairsUp/stairsDown,
 * doors/traps (cell lists), items, mobs. The dungeon generator fills tiles,
 * doors, traps, stairs, feeling/bossLevel/sealed/secretDoors and returns
 * richer spawn lists (ItemSpawn/MobSpawn) alongside; the content designer
 * resolves those into PlacedItem/PlacedMob.
 */

/** An item lying on the floor. Full item defs live in src/content/ (M1 catalog). */
export interface PlacedItem {
  /** Cell index. */
  pos: number;
  /** Item id from the content catalog (e.g. 'potion_healing'). */
  itemId: string;
  /** Sprite key for the renderer. */
  sprite: string;
  /**
   * The item sits in a LOCKED_CHEST/CRYSTAL_CHEST heap (vanilla Heap.Type).
   * Stage 0 (exact copy): heaps are otherwise simplified to floor items,
   * but locked chests need a GoldenKey to open (Hero.actOpenChest,
   * Hero.java:615-648) — see openLockedChest in actions.ts.
   */
  lockedChest?: boolean;
  /**
   * The item is shop stock (vanilla Heap.Type.FOR_SALE, ShopPainter.java:81):
   * it is sold by the shopkeeper, not picked up for free. Set by the content
   * designer when resolving a 'FOR_SALE' ItemSpawn.
   */
  forSale?: boolean;
}

/**
 * A mob standing on the level. Full AI/stats live in src/mechanics/ +
 * src/content/; this is the structural view the engine needs (position,
 * hp bar, sprite, scheduler participation).
 */
export interface PlacedMob {
  id: number;
  x: number;
  y: number;
  hp: number;
  ht: number;
  name: string;
  sprite: string;
  /** Whether this mob is currently hostile/awake (drives HUD alert icons). */
  hostile: boolean;
}

/** Heap presentation for an item spawn point (vanilla Heap.Type, M1 subset). */
export type HeapKind =
  | 'HEAP'
  | 'CHEST'
  | 'MIMIC'
  | 'SKELETON'
  | 'TOMB'
  | 'LOCKED_CHEST'
  | 'CRYSTAL_CHEST'
  | 'FOR_SALE'; // vanilla Heap.Type.FOR_SALE: shop stock (ShopPainter.java:81)

/**
 * An item spawn point produced by the generator, for the content designer.
 * `tag` carries the vanilla intent (e.g. 'iron-key', 'pool-prize', 'grave',
 * 'gold', 'honeypot') so content can resolve the concrete item.
 */
export interface ItemSpawn {
  /** Cell index. */
  pos: number;
  heap: HeapKind;
  tag?: string;
}

/** Mob spawn kinds produced by the generator, for the content designer. */
export type MobKind = 'mob' | 'boss' | 'ratking' | 'statue' | 'piranha' | 'ghost' | 'shopkeeper';

/** A mob spawn point produced by the generator, for the content designer. */
export interface MobSpawn {
  /** Cell index. */
  pos: number;
  kind: MobKind;
}

export class Level extends Grid {
  /** Terrain id per cell (see Terrain enum). */
  tiles: Uint8Array;
  /** Persistent fog-of-war memory: 1 = ever seen. */
  explored: Uint8Array;
  /** Current field of view: 1 = visible right now. Recomputed on every action. */
  visible: Uint8Array;

  depth = 1;
  region: Region = Region.SEWERS;

  /** SPEC §3 aliases for Grid.w/h. */
  get width(): number {
    return this.w;
  }
  get height(): number {
    return this.h;
  }

  /** Up-stairs cell (-1 when absent). */
  stairsUp = -1;
  /** Down-stairs cell (-1 when absent, e.g. boss depth 5). */
  stairsDown = -1;
  /** Door cells (for the renderer / minimap). Kind is encoded in the tile. */
  doors: number[] = [];
  /** Trap cells (hidden or revealed). */
  traps: number[] = [];
  /**
   * Live trap-seeded blobs (Stage 0: fire, toxic, paralytic). Vanilla
   * `Dungeon.level.blobs` (Map<Class, Blob>); the mechanics layer owns the
   * Blob schema (mechanics/blobs.ts), the engine ticks them once per turn.
   */
  blobs: Blob[] = [];

  items: PlacedItem[] = [];
  mobs: PlacedMob[] = [];

  /** Level feeling, rolled for regular depths > 1 (NONE on boss depths). */
  feeling: Feeling = Feeling.NONE;
  /** True on boss depths (M1: depth 5, Goo). */
  bossLevel = false;
  /** Boss-arena seal state (set by the seal mechanic at runtime). */
  sealed = false;
  /** Count of hidden doors placed during generation. */
  secretDoors = 0;

  constructor(w: number, h: number) {
    super(w, h);
    this.tiles = new Uint8Array(w * h);
    this.explored = new Uint8Array(w * h);
    this.visible = new Uint8Array(w * h);
  }

  get(x: number, y: number): Terrain {
    return this.inBounds(x, y) ? (this.tiles[this.idx(x, y)] as Terrain) : Terrain.WALL;
  }

  set(x: number, y: number, t: Terrain): void {
    if (this.inBounds(x, y)) this.tiles[this.idx(x, y)] = t;
  }

  getAt(i: number): Terrain {
    return this.tiles[i] as Terrain;
  }

  isOpaque(x: number, y: number): boolean {
    const t = this.get(x, y);
    return (
      t === Terrain.WALL ||
      t === Terrain.DOOR_SECRET ||
      t === Terrain.HIGH_GRASS ||
      t === Terrain.BARRICADE
    );
  }

  isPassable(x: number, y: number): boolean {
    const t = this.get(x, y);
    switch (t) {
      case Terrain.FLOOR:
      case Terrain.DOOR:
      case Terrain.OPEN_DOOR: // Door.enter (Door.java:14-21): open doors stay passable
      case Terrain.ENTRANCE:
      case Terrain.EXIT:
      case Terrain.WATER:
      case Terrain.GRASS:
      case Terrain.WALKWAY:
      case Terrain.EMBERS:
      case Terrain.HIGH_GRASS:
      case Terrain.TRAP_INACTIVE:
        return true;
      default:
        return isHiddenTrap(t) || (t >= Terrain.TRAP_TOXIC && t <= Terrain.TRAP_SUMMONING && t % 2 === 0);
    }
  }

  /** Reveal a hidden trap; returns its display name, or null if none. */
  revealTrap(x: number, y: number): string | null {
    const t = this.get(x, y);
    if (!isHiddenTrap(t)) return null;
    this.set(x, y, revealTrapTile(t));
    return trapName(t);
  }

  /**
   * Vanilla Level.avoid (Terrain.AVOID flag, Terrain.java): tiles mobs may
   * stand on but pathing avoids — revealed traps, chasm, wells. Used with
   * isPassable for SummoningTrap spawn candidates
   * (passable[p] || avoid[p], SummoningTrap.java).
   */
  isAvoid(x: number, y: number): boolean {
    const t = this.get(x, y);
    return (
      t === Terrain.CHASM ||
      t === Terrain.WELL ||
      (t >= Terrain.TRAP_TOXIC &&
        t <= Terrain.TRAP_SUMMONING &&
        t % 2 === 0 &&
        !isHiddenTrap(t))
    );
  }

  /** Reveal a secret door; returns true when one was revealed. */
  revealSecretDoor(x: number, y: number): boolean {
    if (this.get(x, y) !== Terrain.DOOR_SECRET) return false;
    this.set(x, y, Terrain.DOOR);
    return true;
  }

  /** Recompute `visible` from (cx, cy) and fold newly seen tiles into `explored`. */
  updateFov(cx: number, cy: number, radius: number): void {
    computeFov(this, (x, y) => this.isOpaque(x, y), cx, cy, radius, this.visible);
    for (let i = 0; i < this.size; i++) {
      if (this.visible[i]) this.explored[i] = 1;
    }
  }

  itemAt(x: number, y: number): PlacedItem | undefined {
    const i = this.idx(x, y);
    return this.items.find((it) => it.pos === i);
  }

  mobAt(x: number, y: number): PlacedMob | undefined {
    return this.mobs.find((m) => m.x === x && m.y === y);
  }

  exploredCount(): number {
    let n = 0;
    for (let i = 0; i < this.size; i++) n += this.explored[i];
    return n;
  }
}

/**
 * SEAM (dungeon generator worker): implement this to supply real levels.
 * `generate(rng, depth)` must return a Level with stairs/items/mobs placed.
 */
export interface LevelGen {
  generate(rng: RNG, depth: number): Level;
}

/**
 * ENGINE PLACEHOLDER generator: a single open room with stairs, so the engine,
 * renderer, and input are testable before the real Sewers generator lands.
 * NOT gameplay — the dungeon generator worker replaces this.
 */
export const stubLevelGen: LevelGen = {
  generate(_rng: RNG, depth: number): Level {
    const w = 24;
    const h = 18;
    const lvl = new Level(w, h);
    lvl.depth = depth;
    lvl.region = Region.SEWERS;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) lvl.set(x, y, Terrain.FLOOR);
    }
    // A wall chunk in the middle so FOV/pathing have something to chew on.
    for (let y = 5; y <= 10; y++) lvl.set(12, y, Terrain.WALL);
    lvl.set(12, 8, Terrain.DOOR);
    const up = lvl.idx(2, 2);
    const down = lvl.idx(w - 3, h - 3);
    lvl.set(2, 2, Terrain.ENTRANCE);
    lvl.set(w - 3, h - 3, Terrain.EXIT);
    lvl.stairsUp = up;
    lvl.stairsDown = down;
    return lvl;
  },
};
