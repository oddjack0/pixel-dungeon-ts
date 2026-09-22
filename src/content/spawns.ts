/**
 * Spawn resolution for Milestone 1: turn the dungeon generator's unresolved
 * MobSpawn[]/ItemSpawn[] (src/dungeon/level.ts) into placed catalog items
 * and concrete mob ids.
 *
 * Ground truth for the spawn tables: Bestiary.mobClass
 * (~/workspace/pixel-dungeon-src actors/mobs/Bestiary.java:mobClass).
 * Ground truth for item tags: the painters (src/dungeon/painters.ts) and
 * SewerLevel quest queue (src/dungeon/generator.ts).
 * Java wins every conflict.
 *
 * Fair distance from the entrance is enforced by the generator
 * (notInEntranceView / not visible from the entrance) — resolution never
 * moves a spawn.
 */
import type { RNG } from '../core/rng.js';
import type { MechanicsRng } from '../mechanics/rng.js';
import {
  generateLevel,
  newRunState,
  type GenResult,
} from '../dungeon/generator.js';
import type {
  ItemSpawn,
  LevelGen,
  MobSpawn,
  PlacedItem,
} from '../dungeon/level.js';
import { getItem, parseItemId } from './items.js';
import { itemGenerator, resetItemGenerator } from './itemgen.js';
import { buildMob, nextMobId, type ContentMob } from './mobs.js';

/**
 * Depth -> weighted mob table. Weights are Bestiary.mobClass chances
 * (Bestiary.java:52-98):
 *   depth 1: Rat 1
 *   depth 2: Rat 1, Gnoll 1
 *   depth 3: Rat 1, Gnoll 2, Crab 1, Swarm 0.02
 *   depth 4: Rat 1, Gnoll 2, Crab 3, Swarm 0.02, Skeleton 0.01, Thief 0.01
 *   depth 5: Goo only (SewerBossLevel; handled by the boss flag, not this table)
 */
export const SEWER_MOB_TABLE: Readonly<
  Record<number, ReadonlyArray<{ id: string; weight: number }>>
> = {
  1: [{ id: 'rat', weight: 1 }],
  2: [
    { id: 'rat', weight: 1 },
    { id: 'gnoll', weight: 1 },
  ],
  3: [
    { id: 'rat', weight: 1 },
    { id: 'gnoll', weight: 2 },
    { id: 'crab', weight: 1 },
    { id: 'swarm', weight: 0.02 },
  ],
  4: [
    { id: 'rat', weight: 1 },
    { id: 'gnoll', weight: 2 },
    { id: 'crab', weight: 3 },
    { id: 'swarm', weight: 0.02 },
    { id: 'skeleton', weight: 0.01 },
    { id: 'thief', weight: 0.01 },
  ],
};

/**
 * Weighted pick (Random.chances, Random.java:78-95): first entry whose
 * cumulative weight exceeds a [0, total) roll.
 */
export function pickMobId(rng: MechanicsRng, depth: number): string {
  const table = SEWER_MOB_TABLE[depth] ?? SEWER_MOB_TABLE[4]!;
  let total = 0;
  for (const e of table) total += e.weight;
  const roll = rng.float(0, total);
  let acc = 0;
  for (const e of table) {
    acc += e.weight;
    if (roll < acc) return e.id;
  }
  return table[table.length - 1]!.id;
}

/** A mob spawn with its concrete mob id. */
export interface ResolvedMob {
  pos: number;
  mobId: string;
}

/**
 * Resolve generator mob spawns. MobSpawn kinds (src/dungeon/level.ts):
 * 'mob' -> depth table; 'boss' -> goo; 'ghost'/'ratking'/'statue'/
 * 'piranha' -> M1: skipped (no quest/NPC/statue/piranha mechanics yet,
 * documented).
 */
export function resolveMobSpawns(
  rng: RNG,
  depth: number,
  spawns: MobSpawn[],
): ResolvedMob[] {
  const out: ResolvedMob[] = [];
  for (const s of spawns) {
    if (s.kind === 'mob') {
      out.push({ pos: s.pos, mobId: pickMobId(rng, depth) });
    } else if (s.kind === 'boss') {
      out.push({ pos: s.pos, mobId: 'goo' });
    }
    // ghost/ratking/statue/piranha: skipped for M1.
  }
  return out;
}

/** Build live ContentMobs from resolved spawns (ids from the shared counter). */
export function buildMobs(resolved: ResolvedMob[], w: number): ContentMob[] {
  return resolved.map((r) => buildMob(r.mobId, nextMobId(), r.pos, w));
}

/**
 * M1 random-item draw for the 'random' tag and generator heaps
 * (RegularLevel.java:609: drop(Generator.random(), randomDropCell())).
 * Exact vanilla Generator (src/content/itemgen.ts): category weights
 * WEAPON 15 / ARMOR 10 / POTION 50 / SCROLL 40 / WAND 4 / RING 2 / SEED 5 /
 * GOLD 50 / MISC 5 (Generator.java:38-48) with per-draw halving, reset once
 * per depth (InterlevelScene.java:116).
 */
function pickRandomItemId(rng: MechanicsRng, depth: number): string {
  return itemGenerator.random(rng, depth);
}

/**
 * Resolve one generator item tag to a concrete catalog item id.
 * Painter tags (src/dungeon/painters.ts) and quest tags
 * (src/dungeon/generator.ts). Unknown tags throw — a silent wrong item
 * is worse than a loud one.
 */
export function resolveItemTag(
  rng: MechanicsRng,
  depth: number,
  tag: string,
): string {
  switch (tag) {
    // Quest queue (SewerLevel, via generator.ts).
    case 'food':
      return 'ration';
    case 'potion-of-strength':
      return 'potion_strength';
    case 'scroll-of-upgrade':
      // Dungeon.souNeeded (Dungeon.java:288-291): quota of 3 by depth 5.
      // Random scroll loot never yields it (Generator SCROLL probs weight 0,
      // Generator.java:94); it comes only from the guaranteed quest spawn.
      return 'scroll_upgrade';
    case 'scroll-of-enchantment':
      return 'scroll'; // M1: no scroll ID system yet
    case 'dew-vial':
      return 'potion_healing'; // M1: no dewdrop system; preserves sustain
    // Locked-room keys.
    case 'iron-key':
      return 'iron_key';
    case 'golden-key':
      return 'golden_key'; // Stage 0: opens LOCKED_CHEST/CRYSTAL_CHEST (Hero.actOpenChest)
    // Prize rooms (prize(...) in painters.ts).
    case 'prize-armor':
      return 'cloth_armor'; // M1: only armor in the catalog
    case 'prize-weapon':
      return 'shortsword'; // M1: only weapon in the catalog
    case 'prize-potion':
      return 'potion_healing';
    case 'prize-scroll':
      return 'scroll';
    case 'prize-food':
      return 'ration';
    case 'prize-bomb':
      return `dart:${rng.int(5, 15)}`; // M1: no bombs; darts preserve a throwable (Dart.java:59)
    case 'prize-wand':
    case 'prize-ring':
      return 'scroll'; // M1: no wands/rings
    // Special-room prizes.
    case 'invisibility':
    case 'levitation':
    case 'liquid-flame':
    case 'honeypot':
      return 'potion_healing'; // M1: unidentified potions / bee-less honeypot
    case 'sungrass-seed':
      return 'ration'; // M1: no plant mechanics
    case 'random':
      return pickRandomItemId(rng, depth);
    default:
      throw new Error(`spawns: unknown item tag "${tag}" (M1 has no mapping)`);
  }
}

/**
 * Resolve generator item spawns. 'gold:<n>' passes through (parseItemId);
 * an undefined tag means 'random'. Heap kinds are M1-ignored EXCEPT
 * LOCKED_CHEST/CRYSTAL_CHEST, whose locked state rides on the PlacedItem
 * (vanilla Heap.Type; Hero.actOpenChest needs a GoldenKey — actions.ts).
 * Other chests/bones/mimics place their item directly (documented
 * simplification).
 */
export function resolveItemSpawns(
  rng: RNG,
  depth: number,
  spawns: ItemSpawn[],
): PlacedItem[] {
  return spawns.map((s) => {
    const tag = s.tag ?? 'random';
    const itemId =
      tag === 'gold'
        ? itemGenerator.randomFrom(rng, 'gold', depth) // exact Gold.random() bounds
        : tag.startsWith('gold:')
          ? tag
          : resolveItemTag(rng, depth, tag);
    const { defId } = parseItemId(itemId);
    const lockedChest =
      s.heap === 'LOCKED_CHEST' || s.heap === 'CRYSTAL_CHEST';
    // Vanilla Heap.Type.FOR_SALE (ShopPainter.java:81): shop stock is sold by
    // the shopkeeper, never picked up for free — the shop UI reads this flag.
    const forSale = s.heap === 'FOR_SALE';
    return {
      pos: s.pos,
      itemId,
      sprite: getItem(defId).sprite,
      ...(lockedChest ? { lockedChest: true as const } : {}),
      ...(forSale ? { forSale: true as const } : {}),
    };
  });
}

/** The GenResult pending on a level until the content layer consumes it. */
const pendingResults = new WeakMap<object, GenResult>();

/** Stash the full GenResult so spawnMobs() can resolve it later. */
export function stashGenResult(level: object, result: GenResult): void {
  pendingResults.set(level, result);
}

/** Take (and clear) the stashed GenResult for a level. */
export function takeGenResult(level: object): GenResult | null {
  const r = pendingResults.get(level) ?? null;
  if (r) pendingResults.delete(level);
  return r;
}

/**
 * Content LevelGen: generate the level, resolve item spawns into placed
 * catalog items immediately, and stash the GenResult (mob spawns + depth)
 * for spawnMobs() — which the engine calls right after generate(), so the
 * WeakMap entry never outlives the level handoff.
 */
export const contentLevelGen: LevelGen = {
  generate(rng: RNG, depth: number) {
    // Generator.reset() on depth entry (InterlevelScene.java:116): the
    // per-depth category weights start fresh before any draw.
    resetItemGenerator();
    const result = generateLevel(rng, depth, newRunState());
    const items = resolveItemSpawns(rng, depth, result.items);
    for (const it of items) result.level.items.push(it);
    stashGenResult(result.level, result);
    return result.level;
  },
};
