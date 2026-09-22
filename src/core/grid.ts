/**
 * Grid: bare tile-grid math (indexing, bounds, neighborhoods).
 * Terrain: the canonical terrain id set, copied from the verified oracle
 * (~/workspace/pixel-dungeon-ts/src/dungeon/level.ts). Ids are NEVER renumbered.
 * NOTE: the oracle names this enum `Tile`; it is renamed to `Terrain` here per
 * SPEC contract §1 ("Terrain enum"). Member names, values, and helpers are
 * identical.
 */
export enum Terrain {
  WALL = 0,
  FLOOR = 1,
  DOOR = 2,
  DOOR_LOCKED = 3, // needs an IronKey (Stage 4)
  DOOR_SECRET = 4,
  EXIT_LOCKED = 5, // boss-exit door: needs a SkeletonKey (Stage 5)
  ENTRANCE = 6, // up stairs
  EXIT = 7, // down stairs
  CHASM = 8, // impassable; falling = Stage 3
  WATER = 9, // passable (no swimming in vanilla)
  GRASS = 10, // passable high grass
  WALKWAY = 11, // EMPTY_SP: stone walkway over chasm (weak-floor rooms)
  WELL = 12, // magic well (furniture)
  ALCHEMY = 13, // alchemy pot (furniture)
  PEDESTAL = 14, // furniture
  STATUE = 15, // furniture in Stage 2; animated statue mob in Stage 5
  TOMB = 16, // crypt tomb (furniture)
  BOOKSHELF = 17, // furniture
  CHEST = 18, // furniture; opening = Stage 4
  CHEST_LOCKED = 19, // furniture; opening = Stage 4
  // Traps: hidden variants are SECRET_* terrain; revealed variants are live.
  TRAP_TOXIC = 20,
  TRAP_TOXIC_HIDDEN = 21,
  TRAP_FIRE = 22,
  TRAP_FIRE_HIDDEN = 23,
  TRAP_PARALYTIC = 24,
  TRAP_PARALYTIC_HIDDEN = 25,
  TRAP_POISON = 26,
  TRAP_POISON_HIDDEN = 27,
  TRAP_ALARM = 28,
  TRAP_ALARM_HIDDEN = 29,
  TRAP_LIGHTNING = 30,
  TRAP_LIGHTNING_HIDDEN = 31,
  TRAP_GRIPPING = 32,
  TRAP_GRIPPING_HIDDEN = 33,
  TRAP_SUMMONING = 34,
  TRAP_SUMMONING_HIDDEN = 35,
  TRAP_INACTIVE = 36, // Tengu/DM-300 arena traps: visible, inert
  BARRICADE = 37, // solid; storage-room door (vanilla BARRICADE)
  EMBERS = 38, // burned-room floor (passable)
  HIGH_GRASS = 39, // striped-room tufts (passable, blocks sight)
}

/** The 8 trap types, in vanilla `levels/traps/` order. */
export const TRAP_TYPES = [
  Terrain.TRAP_TOXIC,
  Terrain.TRAP_FIRE,
  Terrain.TRAP_PARALYTIC,
  Terrain.TRAP_POISON,
  Terrain.TRAP_ALARM,
  Terrain.TRAP_LIGHTNING,
  Terrain.TRAP_GRIPPING,
  Terrain.TRAP_SUMMONING,
] as const;

export const TRAP_NAMES: Record<number, string> = {
  [Terrain.TRAP_TOXIC]: 'a toxic gas trap',
  [Terrain.TRAP_FIRE]: 'a fire trap',
  [Terrain.TRAP_PARALYTIC]: 'a paralytic gas trap',
  [Terrain.TRAP_POISON]: 'a poison dart trap',
  [Terrain.TRAP_ALARM]: 'an alarm trap',
  [Terrain.TRAP_LIGHTNING]: 'a lightning trap',
  [Terrain.TRAP_GRIPPING]: 'a gripping trap',
  [Terrain.TRAP_SUMMONING]: 'a summoning trap',
};

export function isHiddenTrap(t: Terrain): boolean {
  return (
    t === Terrain.TRAP_TOXIC_HIDDEN ||
    t === Terrain.TRAP_FIRE_HIDDEN ||
    t === Terrain.TRAP_PARALYTIC_HIDDEN ||
    t === Terrain.TRAP_POISON_HIDDEN ||
    t === Terrain.TRAP_ALARM_HIDDEN ||
    t === Terrain.TRAP_LIGHTNING_HIDDEN ||
    t === Terrain.TRAP_GRIPPING_HIDDEN ||
    t === Terrain.TRAP_SUMMONING_HIDDEN
  );
}

export function isTrap(t: Terrain): boolean {
  return (
    isHiddenTrap(t) ||
    t === Terrain.TRAP_INACTIVE ||
    (t >= Terrain.TRAP_TOXIC && t <= Terrain.TRAP_SUMMONING && t % 2 === 0)
  );
}

/** Hidden -> revealed variant (SECRET_* -> visible). */
export function revealTrapTile(t: Terrain): Terrain {
  return isHiddenTrap(t) ? ((t - 1) as Terrain) : t;
}

export function trapName(t: Terrain): string {
  return TRAP_NAMES[revealTrapTile(t)] ?? 'a trap';
}

/** Region = tileset family, derived from depth (matches the depth map). */
export enum Region {
  SEWERS = 'sewers',
  PRISON = 'prison',
  CAVES = 'caves',
  CITY = 'city',
  HALLS = 'halls',
}

export function regionForDepth(depth: number): Region {
  if (depth <= 5) return Region.SEWERS;
  if (depth <= 10) return Region.PRISON;
  if (depth <= 15) return Region.CAVES;
  if (depth <= 21) return Region.CITY;
  return Region.HALLS;
}

export const REGION_LABELS: Record<Region, string> = {
  [Region.SEWERS]: 'Sewers',
  [Region.PRISON]: 'Prison',
  [Region.CAVES]: 'Caves',
  [Region.CITY]: 'Metropolis',
  [Region.HALLS]: 'Demon Halls',
};

/** Display label for a region. */
export function regionLabel(r: Region): string {
  return REGION_LABELS[r];
}

/** Level feelings (`Level.Feeling`): rolled for regular levels when depth > 1. */
export enum Feeling {
  NONE = 'none',
  CHASM = 'chasm',
  WATER = 'water',
  GRASS = 'grass',
}

/** Integer tile coordinate. */
export interface XY {
  x: number;
  y: number;
}

const DIRS4: ReadonlyArray<XY> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const DIRS8: ReadonlyArray<XY> = [
  ...DIRS4,
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/** Bare tile grid: indexing, bounds, neighborhoods. Level extends this. */
export class Grid {
  readonly w: number;
  readonly h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  get size(): number {
    return this.w * this.h;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  xy(i: number): XY {
    return { x: i % this.w, y: Math.floor(i / this.w) };
  }

  neighbors4(x: number, y: number): XY[] {
    const out: XY[] = [];
    for (const d of DIRS4) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (this.inBounds(nx, ny)) out.push({ x: nx, y: ny });
    }
    return out;
  }

  neighbors8(x: number, y: number): XY[] {
    const out: XY[] = [];
    for (const d of DIRS8) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (this.inBounds(nx, ny)) out.push({ x: nx, y: ny });
    }
    return out;
  }

  static chebyshev(ax: number, ay: number, bx: number, by: number): number {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }
}
