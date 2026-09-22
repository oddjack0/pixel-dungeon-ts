/**
 * Wand mechanics — exact port of the wand system from
 * `items/wands/Wand.java` plus the 13 wand subclasses, watabou/pixel-dungeon
 * (GPL-3.0, (C) 2012-2015 Oleg Dolya). Only pure math / trace logic lives
 * here: charge model, power(), melee formulas, Ballistica, per-wand damage
 * and placement formulas. World effects (blobs, terrain, chars, buffs) are
 * resolved in `src/content/wands.ts` against an ActionContext.
 */

import type { MechanicsRng } from './rng.js';

/* ------------------------------------------------------------------ */
/* Wand specs (static per-class data; the mutable part is WandState in  */
/* content/wands.ts). `wood` is the ItemStatusHandler label in handler  */
/* order (Wand.java:66-69): teleportation holly, slowness yew, firebolt  */
/* ebony, poison cherry, regrowth teak, blink rowan, lightning willow,  */
/* amok mahogany, reach bamboo, flock purpleheart, disintegration oak,   */
/* avalanche birch. Magic Missile is NOT in the handler (fixed image,    */
/* always known, WandOfMagicMissile.java:30-33).                        */
/* ------------------------------------------------------------------ */

export interface WandSpec {
  /** Short id, e.g. 'firebolt'. Catalog item ids are `wand_<id>`. */
  id: string;
  /** Java class name, e.g. 'WandOfFirebolt'. */
  className: string;
  /** The exact vanilla name ("Wand of Firebolt"). */
  name: string;
  /** The exact vanilla desc() text. */
  desc: string;
  /** Handler wood label; null for Magic Missile (fixed sprite). */
  wood: string | null;
  /** Sprite key in src/assets/original_sprites.ts. */
  sprite: string;
  /** Initial charges (Wand.java:71-74): 3 for Magic Missile, 2 else. */
  initialCharges: number;
  /** Ballistica hitChars flag for this wand (zapper.onSelect). */
  hitChars: boolean;
}

export const WAND_SPECS: readonly WandSpec[] = [
  {
    id: 'teleportation',
    className: 'WandOfTeleportation',
    name: 'Wand of Teleportation',
    desc:
      'A blast from this wand will teleport a creature against ' +
      'its will to a random place on the current level.',
    wood: 'holly',
    sprite: 'item_wand_teleportation',
    initialCharges: 2,
    hitChars: true,
  },
  {
    id: 'slowness',
    className: 'WandOfSlowness',
    name: 'Wand of Slowness',
    desc:
      'This wand will cause a creature to move and attack ' +
      'at half its ordinary speed until the effect ends',
    wood: 'yew',
    sprite: 'item_wand_slowness',
    initialCharges: 2,
    hitChars: true,
  },
  {
    id: 'firebolt',
    className: 'WandOfFirebolt',
    name: 'Wand of Firebolt',
    desc:
      'This wand unleashes bursts of magical fire. It will ignite ' +
      'flammable terrain, and will damage and burn a creature it hits.',
    wood: 'ebony',
    sprite: 'item_wand_firebolt',
    initialCharges: 2,
    hitChars: true,
  },
  {
    id: 'poison',
    className: 'WandOfPoison',
    name: 'Wand of Poison',
    desc:
      'The vile blast of this twisted bit of wood will imbue its target ' +
      'with a deadly venom. A creature that is poisoned will suffer periodic ' +
      'damage until the effect ends. The duration of the effect increases ' +
      'with the level of the staff.',
    wood: 'cherry',
    sprite: 'item_wand_poison',
    initialCharges: 2,
    hitChars: true,
  },
  {
    id: 'regrowth',
    className: 'WandOfRegrowth',
    name: 'Wand of Regrowth',
    desc:
      '"When life ceases new life always begins to grow... The eternal cycle always remains!"',
    wood: 'teak',
    sprite: 'item_wand_regrowth',
    initialCharges: 2,
    hitChars: false,
  },
  {
    id: 'blink',
    className: 'WandOfBlink',
    name: 'Wand of Blink',
    desc:
      'This wand will allow you to teleport in the chosen direction. ' +
      'Creatures and inanimate obstructions will block the teleportation.',
    wood: 'rowan',
    sprite: 'item_wand_blink',
    initialCharges: 2,
    hitChars: true,
  },
  {
    id: 'lightning',
    className: 'WandOfLightning',
    name: 'Wand of Lightning',
    desc:
      'This wand conjures forth deadly arcs of electricity, which deal damage ' +
      'to several creatures standing close to each other.',
    wood: 'willow',
    sprite: 'item_wand_lightning',
    initialCharges: 2,
    hitChars: true,
  },
  {
    id: 'amok',
    className: 'WandOfAmok',
    name: 'Wand of Amok',
    desc:
      'The purple light from this wand will make the target run amok ' +
      'attacking random creatures in its vicinity.',
    wood: 'mahogany',
    sprite: 'item_wand_amok',
    initialCharges: 2,
    hitChars: true,
  },
  {
    id: 'reach',
    className: 'WandOfReach',
    name: 'Wand of Reach',
    desc:
      'This utility wand can be used to grab objects from a distance and to switch places with enemies. ' +
      'Waves of magic force radiated from it will affect all cells on their way triggering traps, ' +
      'trampling high vegetation, opening closed doors and closing open ones.',
    wood: 'bamboo',
    sprite: 'item_wand_reach',
    initialCharges: 2,
    hitChars: false,
  },
  {
    id: 'flock',
    className: 'WandOfFlock',
    name: 'Wand of Flock',
    desc:
      'A flick of this wand summons a flock of magic sheep, creating temporary impenetrable obstacle.',
    wood: 'purpleheart',
    sprite: 'item_wand_flock',
    initialCharges: 2,
    hitChars: false,
  },
  {
    id: 'disintegration',
    className: 'WandOfDisintegration',
    name: 'Wand of Disintegration',
    desc:
      'This wand emits a beam of destructive energy, which pierces all creatures in its way. ' +
      'The more targets it hits, the more damage it inflicts to each of them.',
    wood: 'oak',
    sprite: 'item_wand_disintegration',
    initialCharges: 2,
    hitChars: false,
  },
  {
    id: 'avalanche',
    className: 'WandOfAvalanche',
    name: 'Wand of Avalanche',
    desc:
      'When a discharge of this wand hits a wall (or any other solid obstacle) it causes ' +
      'an avalanche of stones, damaging and stunning all creatures in the affected area.',
    wood: 'birch',
    sprite: 'item_wand_avalanche',
    initialCharges: 2,
    hitChars: false,
  },
  {
    id: 'magic_missile',
    className: 'WandOfMagicMissile',
    name: 'Wand of Magic Missile',
    desc:
      'This wand launches missiles of pure magical energy, dealing moderate damage to a target creature.',
    wood: null,
    sprite: 'item_wand_magicmissile',
    initialCharges: 3,
    hitChars: true,
  },
];

/** Look up a wand spec by short id. */
export function wandSpec(id: string): WandSpec {
  const spec = WAND_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`wands: unknown wand id ${id}`);
  return spec;
}

/* ------------------------------------------------------------------ */
/* Per-wand zap parameters (pure rolls / index math). The world effects */
/* are resolved in content/wands.ts.                                   */
/* ------------------------------------------------------------------ */

/** Magic Missile (WandOfMagicMissile.java:51): Random.Int(1, 6 + 2*power). */
export function magicMissileDamage(rng: MechanicsRng, power: number): number {
  return rng.int(1, 6 + 2 * power);
}

/** Firebolt (WandOfFirebolt.java:66): Random.Int(1, 8 + power^2). */
export function fireboltDamage(rng: MechanicsRng, power: number): number {
  return rng.int(1, 8 + power * power);
}

/** Lightning initial bolt (WandOfLightning.java:56): Int(5 + power/2, 10 + power). */
export function lightningInitialDamage(rng: MechanicsRng, power: number): number {
  return rng.int(5 + Math.floor(power / 2), 10 + power);
}

/** Lightning chain step (WandOfLightning.java:70): Int(damage/2, damage). */
export function lightningChainDamage(rng: MechanicsRng, damage: number): number {
  return rng.int(Math.floor(damage / 2), damage);
}

/**
 * Disintegration (WandOfDisintegration.java:52-74):
 * maxDistance = level() + 4 (RAW level, not power); each target takes
 * Random.NormalIntRange(lvl, 8 + lvl^2/3) with lvl = power + targets hit.
 */
export function disintegrationMaxDistance(rawLevel: number): number {
  return rawLevel + 4;
}

export function disintegrationDamage(rng: MechanicsRng, power: number, targets: number): number {
  const lvl = power + targets;
  return rng.normalIntRange(lvl, 8 + Math.floor((lvl * lvl) / 3));
}

/**
 * Avalanche (WandOfAvalanche.java:54-98):
 * size = 1 + power/3; ballistica capped at 8 + power; per-cell damage
 * Random.Int(2, 6 + (size - d)*2); paralysis when Random.Int(2 + d) == 0.
 */
export function avalancheSize(power: number): number {
  return 1 + Math.floor(power / 3);
}

export function avalancheCastDistance(power: number): number {
  return 8 + power;
}

export function avalancheDamage(rng: MechanicsRng, size: number, dist: number): number {
  return rng.int(2, 6 + (size - dist) * 2);
}

export function avalancheParalyzes(rng: MechanicsRng, dist: number): boolean {
  return rng.int(0, 2 + dist) === 0;
}

/** Avalanche paralysis duration (WandOfAvalanche.java:88): IntRange(2, 6). */
export function avalancheParalysisDuration(rng: MechanicsRng): number {
  return rng.intRange(2, 6);
}

/** Poison (WandOfPoison.java:55): durationFactor * (5 + power). */
export function poisonWandDuration(power: number): number {
  return 5 + power;
}

/** Amok on non-hero (WandOfAmok.java:59): 3 + power. */
export function amokDuration(power: number): number {
  return 3 + power;
}

/**
 * Blink destination (WandOfBlink.java:53-62): when the beam overshoots past
 * power+4, the hero lands at trace[power+3]; when the impact cell holds a
 * char and the beam travelled, one cell before it.
 */
export function blinkDestinationCell(
  trace: number[],
  distance: number,
  power: number,
  impactCellOccupied: boolean,
): number {
  let cell: number;
  if (distance > power + 4) {
    cell = trace[power + 3]!;
  } else {
    cell = trace[distance - 1]!;
    if (impactCellOccupied && distance > 1) {
      cell = trace[distance - 2]!;
    }
  }
  return cell;
}

/** Flock (WandOfFlock.java:64-66): n = power + 2 sheep, lifespan = power + 3. */
export function flockSheepCount(power: number): number {
  return power + 2;
}

export function flockLifespan(power: number): number {
  return power + 3;
}

/**
 * Flock placement (WandOfFlock.java:68-109): BFS distance map from the impact
 * cell over (passable || avoid) minus char cells, capped at radius n; the
 * impact cell itself is excluded (distance[cell] = MAX). Sheep are placed at
 * the n nearest cells with the smallest distances, scanning cell index
 * order per distance ring.
 *
 * @param passableAt vanilla Level.passable[c] || Level.avoid[c]
 * @param occupiedAt char present at cell
 * @param cell impact cell
 * @returns up to n positions (fewer when the area is boxed in)
 */
/**
 * Vanilla WandOfFlock sheep placement (WandOfFlock.java:54-104), exact:
 *
 * 1. The impact cell shifts one trace cell back when occupied and the
 *    beam is longer than 2 (`Actor.findChar(cell) != null &&
 *    Ballistica.distance > 2`).
 * 2. Traversal = (passable || avoid) with EVERY char's cell blocked
 *    (`passable[char.pos] = false`) — chars block paths, not just seats.
 * 3. Distance map from the cell, max distance n = level + 2.
 * 4. When the endpoint is occupied, it is excluded and placement starts
 *    at distance 1.
 * 5. Each of the n sheep takes the LOWEST-index cell at the current
 *    distance ring; the ring advances when exhausted (the `sheepLabel`
 *    loop). A sheep is skipped when no ring below n has a free cell.
 *
 * `occupiedAt` covers every char (hero + mobs); the endpoint adjustment
 * in step 1 happens in the caller (it needs the trace).
 */
export function flockSheepPositions(
  w: number,
  h: number,
  cell: number,
  passable: (pos: number) => boolean,
  occupiedAt: (pos: number) => boolean,
  n: number,
): number[] {
  // Step 2: chars block traversal.
  const trav = (pos: number) => passable(pos) && !occupiedAt(pos);
  // PathFinder.buildDistanceMap uses the 4-neighbourhood.
  const dist = buildDistanceMap(w, h, cell, trav, n);
  // Step 4.
  let d = 0;
  if (occupiedAt(cell)) {
    dist[cell] = Infinity;
    d = 1;
  }
  // Step 5: the sheepLabel loop.
  const placed: number[] = [];
  const length = w * h;
  sheepLoop: for (let i = 0; i < n; i++) {
    while (d < n) {
      for (let j = 0; j < length; j++) {
        if (dist[j] === d) {
          placed.push(j);
          dist[j] = Infinity;
          continue sheepLoop;
        }
      }
      d++;
    }
  }
  return placed;
}

/** Reach (WandOfReach.java:57): reach = min(ballistica distance, power + 4). */
export function reachDistance(ballisticaDistance: number, power: number): number {
  return Math.min(ballisticaDistance, power + 4);
}

/** Regrowth seed amount (WandOfRegrowth.java:78): (power + 2) * 20. */
export function regrowthSeedAmount(power: number): number {
  return (power + 2) * 20;
}

/* ------------------------------------------------------------------ */
/* Zap flow messages (vanilla text constants)                          */
/* ------------------------------------------------------------------ */

/** Wand.zapper: target == curUser.pos (Wand.java:243). */
export const TXT_SELF_TARGET = "You can't target yourself";

/** Wand.zapper fizzle (Wand.java:253-256). */
export const TXT_FIZZLES = 'your wand fizzles; it must be out of charges for now';

/** Item.identify prompt (Wand.wandUsed, Wand.java:274): "You are now familiar enough with your %s." */
export function txtWandIdentified(wandName: string): string {
  return `You are now familiar enough with your ${wandName}.`;
}

/** WandOfReach transport (WandOfReach.java:43-44): "You have magically transported %s into your backpack". */
export function txtReachTransported(itemName: string): string {
  return `You have magically transported ${itemName} into your backpack`;
}

/** WandOfPoison/Amok/Slowness no-target (WandOfPoison.java:60 etc.): "nothing happened". */
export const TXT_NOTHING_HAPPENED = 'nothing happened';


/* ------------------------------------------------------------------ */
/* Charge model (Wand.java)                                            */
/* ------------------------------------------------------------------ */

/** Successful zaps before the wand is identified (Wand.java:56). */
export const USAGES_TO_KNOW = 40;

/** maxCharges (Wand.updateLevel, Wand.java:127-134): min(initial + level, 9). */
export function wandMaxCharges(initialCharges: number, level: number): number {
  return Math.min(initialCharges + level, 9);
}

/**
 * Turns of charge accumulation per +1 charge (Wand.Charger.delay,
 * Wand.java:313-322). The port is warrior-only, so the mage branch
 * (40 / sqrt(1 + effectiveLevel)) is inert — kept for Stage 5.
 */
export function wandRechargeTurns(isMage: boolean, effectiveLevel: number): number {
  return isMage ? 40 / Math.sqrt(1 + effectiveLevel) : 40;
}

/**
 * Wand.power() (Wand.java:154-165): the effective level when zapping.
 * `ringPowerLevel` is the bearer's RingOfPower buff level, or null when the
 * bearer wears no Ring of Power. `charging` is false when the wand is on the
 * ground (Charger null -> plain effective level, Wand.java:164).
 */
export function wandPower(
  effectiveLevel: number,
  ringPowerLevel: number | null,
  charging: boolean,
): number {
  if (!charging) return effectiveLevel;
  if (ringPowerLevel === null) return effectiveLevel;
  return Math.max(effectiveLevel + ringPowerLevel, 0);
}

/* ------------------------------------------------------------------ */
/* Melee formulas (Wand.min / Wand.max, Wand.java:203-215)             */
/* ------------------------------------------------------------------ */

/** Wand.min(): tier = 1 + effectiveLevel/3 (int div); min = tier. */
export function wandMeleeMin(effectiveLevel: number): number {
  return 1 + Math.floor(effectiveLevel / 3);
}

/** Wand.max(): (tier^2 - tier + 10)/2 + effectiveLevel (int div). */
export function wandMeleeMax(effectiveLevel: number): number {
  const tier = 1 + Math.floor(effectiveLevel / 3);
  return Math.floor((tier * tier - tier + 10) / 2) + effectiveLevel;
}

/* ------------------------------------------------------------------ */
/* Ballistica (mechanics/Ballistica.java)                              */
/* ------------------------------------------------------------------ */

export interface BallisticaResult {
  /** Cells along the trace, trace[0] = source. */
  trace: number[];
  /** Number of trace cells (distance counter in vanilla). */
  distance: number;
  /** Impact cell = trace[distance - 1]. */
  cell: number;
}

export interface BallisticaWorld {
  w: number;
  h: number;
  /**
   * Vanilla `Level.passable[cell] || Level.avoid[cell]`. When false the beam
   * stops BEFORE the cell: the cell is excluded from the trace and the
   * distance is decremented (Ballistica.java:116-118).
   */
  beamPassableAt: (pos: number) => boolean;
  /**
   * Vanilla `Level.losBlocking[cell]` (Terrain.java: LOS_BLOCKING on WALL,
   * DOOR, SECRET_DOOR, HIGH_GRASS, BARRICADE). When true the beam stops AT
   * the cell: the cell is included as the impact cell (Ballistica.java:120).
   * NOTE: this intentionally differs from the port's FOV `isOpaque`
   * (src/dungeon/level.ts), which does not treat closed DOORs as opaque —
   * a pre-existing Stage 0/1 decision. For beams, Java wins.
   */
  losBlockingAt: (pos: number) => boolean;
  /** True when a char occupies the cell (only consulted when hitChars). */
  charAt: (pos: number) => boolean;
}

/**
 * Ballistica.cast(from, to, magic, hitChars) — Ballistica.java:55-133,
 * ported statement by statement.
 *
 * - `distance` counts the source cell, then one per appended trace cell.
 * - Non-passable non-avoid cell: the cell is NOT appended to the impact —
 *   `trace[--distance - 1]` is returned, i.e. the last free cell.
 * - LOS-blocking cell (or a char when hitChars): the cell IS the impact.
 * - `magic` beams ignore `to` and fly until blocked (the zapper always
 *   casts with magic=true); non-magic beams stop after appending `to`
 *   (which vanilla appends twice — the duplicate is preserved because
 *   wand effects index trace[distance-2], e.g. WandOfBlink).
 */
export function ballisticaCast(
  world: BallisticaWorld,
  from: number,
  to: number,
  magic: boolean,
  hitChars: boolean,
): BallisticaResult {
  const w = world.w;
  const x0 = from % w;
  const x1 = to % w;
  const y0 = Math.floor(from / w);
  const y1 = Math.floor(to / w);

  let dx = x1 - x0;
  let dy = y1 - y0;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  dx = Math.abs(dx);
  dy = Math.abs(dy);

  let stepA: number;
  let stepB: number;
  let dA: number;
  let dB: number;
  if (dx > dy) {
    stepA = stepX;
    stepB = stepY * w;
    dA = dx;
    dB = dy;
  } else {
    stepA = stepY * w;
    stepB = stepX;
    dA = dy;
    dB = dx;
  }

  const trace: number[] = [from];
  let distance = 1;
  let cell = from;
  let err = Math.floor(dA / 2);

  while (cell !== to || magic) {
    cell += stepA;
    err += dB;
    if (err >= dA) {
      err = err - dA;
      cell = cell + stepB;
    }
    trace.push(cell);
    distance++;

    if (!world.beamPassableAt(cell)) {
      distance--;
      return { trace, distance, cell: trace[distance - 1]! };
    }
    if (world.losBlockingAt(cell) || (hitChars && world.charAt(cell))) {
      return { trace, distance, cell };
    }
  }

  // Vanilla appends `to` a second time here (Ballistica.java:127-129).
  trace.push(cell);
  distance++;
  return { trace, distance, cell: to };
}

/* ------------------------------------------------------------------ */
/* BFS distance map (PathFinder.buildDistanceMap)                       */
/* ------------------------------------------------------------------ */

/**
 * Vanilla PathFinder.buildDistanceMap(from, passable, maxDistance):
 * BFS over `passable` cells; distance[from] = 0; cells beyond
 * maxDistance (or unreachable) are Infinity. Used by WandOfAvalanche
 * (from the impact cell, over non-solid cells, max `size`) and by the
 * WandOfFlock sheep search (different shape — see flockSheepPositions).
 */
export function buildDistanceMap(
  w: number,
  h: number,
  from: number,
  passable: (pos: number) => boolean,
  maxDistance: number,
): Float64Array {
  const length = w * h;
  const dist = new Float64Array(length).fill(Infinity);
  if (from < 0 || from >= length) return dist;
  // Vanilla PathFinder seeds the origin unconditionally (distance[to] = 0
  // even when !passable[to]); neighbours must still be passable.
  dist[from] = 0;
  let frontier = [from];
  let d = 0;
  while (frontier.length > 0 && d < maxDistance) {
    d++;
    const next: number[] = [];
    for (const pos of frontier) {
      const x = pos % w;
      const y = Math.floor(pos / w);
      const push = (n: number) => {
        if (dist[n] === Infinity && passable(n)) {
          dist[n] = d;
          next.push(n);
        }
      };
      if (x > 0) push(pos - 1);
      if (x < w - 1) push(pos + 1);
      if (y > 0) push(pos - w);
      if (y < h - 1) push(pos + w);
    }
    frontier = next;
  }
  return dist;
}
