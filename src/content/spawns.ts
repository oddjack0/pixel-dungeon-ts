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
import { Terrain } from '../core/grid.js';
import type { MechanicsRng } from '../mechanics/rng.js';
import {
  generateLevel,
  newRunState,
  type GenResult,
  type RunState,
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
import {
  blacksmithQuest,
  ghostQuest,
  initGhostQuest,
  initWandmakerQuest,
  wandmakerQuest,
} from './npcs.js';

/**
 * Depth -> weighted mob table. Weights are Bestiary.mobClass chances
 * (Bestiary.java:52-98):
 *   depth 1: Rat 1
 *   depth 2: Rat 1, Gnoll 1
 *   depth 3: Rat 1, Gnoll 2, Crab 1, Swarm 0.02
 *   depth 4: Rat 1, Gnoll 2, Crab 3, Swarm 0.02, Skeleton 0.01, Thief 0.01
 *   depth 5: Goo only (SewerBossLevel; handled by the boss flag, not this table)
 *   depth 6: Skeleton 4, Thief 2, Swarm 1, Shaman 0.2 (Bestiary.java:90-93)
 *   depth 7: Skeleton 3, Shaman 1, Thief 1, Swarm 1 (Bestiary.java:94-97)
 *   depth 8: Skeleton 3, Shaman 2, Gnoll 1, Thief 1, Swarm 1, Bat 0.02
 *     (Bestiary.java:98-101)
 *   depth 9: Skeleton 3, Shaman 3, Thief 1, Swarm 1, Bat 0.02, Brute 0.01
 *     (Bestiary.java:102-105)
 *   depth 10: Tengu only (PrisonBossLevel; handled by the boss flag, not this table)
 * --- Stage 2: Caves (Bestiary.java:110-136) ---
 *   depth 11: Bat 1, Brute 0.2 (Bestiary.java:111-114)
 *   depth 12: Bat 1, Brute 1, Spinner 0.2 (Bestiary.java:115-119)
 *   depth 13: Bat 1, Brute 3, Shaman 1, Spinner 1, Elemental 0.02
 *     (Bestiary.java:120-126)
 *   depth 14: Bat 1, Brute 3, Shaman 1, Spinner 4, Elemental 0.02, Monk 0.01
 *     (Bestiary.java:127-135)
 *   depth 15: DM-300 only (CavesBossLevel; handled by the boss flag, not this table)
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
  6: [
    { id: 'skeleton', weight: 4 },
    { id: 'thief', weight: 2 },
    { id: 'swarm', weight: 1 },
    { id: 'shaman', weight: 0.2 },
  ],
  7: [
    { id: 'skeleton', weight: 3 },
    { id: 'shaman', weight: 1 },
    { id: 'thief', weight: 1 },
    { id: 'swarm', weight: 1 },
  ],
  8: [
    { id: 'skeleton', weight: 3 },
    { id: 'shaman', weight: 2 },
    { id: 'gnoll', weight: 1 },
    { id: 'thief', weight: 1 },
    { id: 'swarm', weight: 1 },
    { id: 'bat', weight: 0.02 },
  ],
  9: [
    { id: 'skeleton', weight: 3 },
    { id: 'shaman', weight: 3 },
    { id: 'thief', weight: 1 },
    { id: 'swarm', weight: 1 },
    { id: 'bat', weight: 0.02 },
    { id: 'brute', weight: 0.01 },
  ],
  // --- Stage 2: Caves (Bestiary.java:110-136) ---
  11: [
    { id: 'bat', weight: 1 },
    { id: 'brute', weight: 0.2 },
  ],
  12: [
    { id: 'bat', weight: 1 },
    { id: 'brute', weight: 1 },
    { id: 'spinner', weight: 0.2 },
  ],
  13: [
    { id: 'bat', weight: 1 },
    { id: 'brute', weight: 3 },
    { id: 'shaman', weight: 1 },
    { id: 'spinner', weight: 1 },
    { id: 'elemental', weight: 0.02 },
  ],
  14: [
    { id: 'bat', weight: 1 },
    { id: 'brute', weight: 3 },
    { id: 'shaman', weight: 1 },
    { id: 'spinner', weight: 4 },
    { id: 'elemental', weight: 0.02 },
    { id: 'monk', weight: 0.01 },
  ],
  // depth 15: DM-300 only — boss flag, no table entry.
  // --- Stage 3: City (Bestiary.java:134-151) ---
  // depth 16: Elemental 1, Warlock 1, Monk 0.2 (Bestiary.java:134-137)
  16: [
    { id: 'elemental', weight: 1 },
    { id: 'warlock', weight: 1 },
    { id: 'monk', weight: 0.2 },
  ],
  // depth 17: Elemental 1, Monk 1, Warlock 1 (Bestiary.java:138-141)
  17: [
    { id: 'elemental', weight: 1 },
    { id: 'monk', weight: 1 },
    { id: 'warlock', weight: 1 },
  ],
  // depth 18: Elemental 1, Monk 2, Golem 1, Warlock 1 (Bestiary.java:142-145)
  18: [
    { id: 'elemental', weight: 1 },
    { id: 'monk', weight: 2 },
    { id: 'golem', weight: 1 },
    { id: 'warlock', weight: 1 },
  ],
  // depth 19: Elemental 1, Monk 2, Golem 3, Warlock 1, Succubus 0.02
  // (Bestiary.java:146-149)
  19: [
    { id: 'elemental', weight: 1 },
    { id: 'monk', weight: 2 },
    { id: 'golem', weight: 3 },
    { id: 'warlock', weight: 1 },
    { id: 'succubus', weight: 0.02 },
  ],
  // depth 20: King only — boss flag, no table entry.
};

/**
 * Bestiary.mutable (Bestiary.java:37-53): 1/30 of the time the resolved mob
 * is a rare variant — Rat -> albino rat, Thief -> crazy bandit,
 * Brute -> shielded brute. (Java also maps Monk -> senior and
 * Scorpio -> acidic at later depths; those land with their depths.)
 * Vanilla call site: the level respawner (Level.java:370) — regular level
 * spawns and the summoning trap use the plain table. The port has no
 * respawner yet; this is exported for it.
 */
export function mutable(rng: MechanicsRng, mobId: string): string {
  if (rng.int(0, 30) === 0) {
    // Random.Int(30) == 0 (Bestiary.java:46)
    switch (mobId) {
      case 'rat':
        return 'albino';
      case 'thief':
        return 'bandit';
      case 'brute':
        return 'shielded';
      default:
        break;
    }
  }
  return mobId;
}

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
 * 'mob' -> depth table; 'boss' -> goo (depth 5) / tengu (depth 10) / dm300 (depth 15);
 * 'ghost' -> the sad ghost (once/run quest NPC); 'wandmaker' -> the old
 * wandmaker (once/run quest NPC); 'shopkeeper' -> the shop NPC;
 * 'ratking'/'statue'/'piranha' -> M1: skipped (no ratking/statue/piranha
 * mechanics yet, documented).
 */
export function resolveMobSpawns(
  rng: RNG,
  depth: number,
  spawns: MobSpawn[],
  level?: { w: number; h: number; getAt(pos: number): Terrain },
): ResolvedMob[] {
  const out: ResolvedMob[] = [];
  for (const s of spawns) {
    if (s.kind === 'mob') {
      out.push({ pos: s.pos, mobId: pickMobId(rng, depth) });
    } else if (s.kind === 'boss') {
      // Bestiary.mob(depth): depth 10 -> Tengu (Bestiary.java:107-110),
      // depth 15 -> DM-300 (Bestiary.java:133-136). Vanilla's boss levels
      // (Goo depth 5, Tengu depth 10, DM-300 depth 15) place the boss via
      // their own level logic; the generator marks the spawn point.
      out.push({ pos: s.pos, mobId: depth === 15 ? 'dm300' : depth === 10 ? 'tengu' : 'goo' });
    } else if (s.kind === 'ghost') {
      // Vanilla Ghost.Quest.spawn: once per run (Ghost.java:234). The
      // generator marks its own run state, but the quest singleton is the
      // run-level guard here (the generator's RunState is per-depth in the
      // SEAM adapter path).
      if (!ghostQuest.spawned) {
        initGhostQuest(rng, depth);
        out.push({ pos: s.pos, mobId: 'ghost' });
      }
    } else if (s.kind === 'wandmaker') {
      // Vanilla Wandmaker.Quest.spawn: once per run (Wandmaker.java:183).
      // The FISH->BERRY/DUST fallback counts the level's water tiles
      // (Wandmaker.java:193-203).
      if (!wandmakerQuest.spawned) {
        let water = 0;
        let length = 0;
        if (level) {
          length = level.w * level.h;
          for (let i = 0; i < length; i++) {
            if (level.getAt(i) === Terrain.WATER) water++;
          }
        }
        initWandmakerQuest(rng, water, length);
        out.push({ pos: s.pos, mobId: 'wandmaker' });
      }
    } else if (s.kind === 'shopkeeper') {
      out.push({ pos: s.pos, mobId: 'shopkeeper' });
    } else if (s.kind === 'blacksmith') {
      // Vanilla Blacksmith.Quest.spawn (Blacksmith.java:305-320): once per
      // run, on depths 12-14 — the generator marks run.blacksmithSpawned when
      // it assigns the BLACKSMITH room; the quest singleton is the run-level
      // guard here (ghost/wandmaker pattern). Vanilla sets alternative =
      // Random.Int(2)==0 and given = false on spawn (Blacksmith.java:315-317).
      // The NPC entity class is Worker 5's (npcs.ts 'blacksmith' seam).
      if (!blacksmithQuest.spawned) {
        blacksmithQuest.spawned = true;
        blacksmithQuest.alternative = rng.int(0, 2) === 0;
        blacksmithQuest.given = false;
        out.push({ pos: s.pos, mobId: 'blacksmith' });
      }
    }
    // ratking/statue/piranha: skipped for M1.
  }
  return out;
}

/** Build live ContentMobs from resolved spawns (ids from the shared counter). */
export function buildMobs(resolved: ResolvedMob[], w: number, depth = 0): ContentMob[] {
  return resolved.map((r) => buildMob(r.mobId, nextMobId(), r.pos, w, depth));
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
    // Shop stock (ShopPainter.java:103-147, via shopPainter.ts): the exact
    // tag strings the shop painter emits, resolved to catalog ids.
    case 'quarterstaff':
      return 'quarterstaff';
    case 'spear':
      return 'spear';
    case 'leather-armor':
      return 'leather_armor';
    case 'seed-pouch':
      return 'seed_pouch';
    case 'weightstone':
      return 'weightstone';
    case 'sword':
      return 'sword';
    case 'mace':
      return 'mace';
    case 'mail-armor':
      return 'mail_armor';
    case 'scroll-holder':
      return 'scroll_holder';
    case 'longsword':
      return 'longsword';
    case 'battle-axe':
      return 'battle_axe';
    case 'scale-armor':
      return 'scale_armor';
    case 'wand-holster':
      return 'wand_holster';
    case 'glaive':
      return 'glaive';
    case 'war-hammer':
      return 'war_hammer';
    case 'plate-armor':
      return 'plate_armor';
    case 'torch':
      return 'torch';
    case 'potion-of-healing':
      return 'potion_healing';
    case 'random-potion':
      // ShopPainter.java:135 — Generator.random(Category.POTION).
      return itemGenerator.randomFrom(rng, 'potion', depth);
    case 'scroll-of-identify':
      return 'scroll_identify';
    case 'scroll-of-remove-curse':
      return 'scroll_removecurse';
    case 'scroll-of-magic-mapping':
      return 'scroll_magicmapping';
    case 'random-scroll':
      // ShopPainter.java:145 — Generator.random(Category.SCROLL).
      return itemGenerator.randomFrom(rng, 'scroll', depth);
    case 'overpriced-ration':
      return 'overpriced_ration';
    case 'ankh':
      return 'ankh';
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
  generate(rng: RNG, depth: number, run?: RunState) {
    // Generator.reset() on depth entry (InterlevelScene.java:116): the
    // per-depth category weights start fresh before any draw.
    resetItemGenerator();
    // The engine threads its per-run RunState (ghost/wandmaker/dew vial/
    // scroll quota/weak floor persist across depths); direct callers that
    // pass none get an isolated state.
    const result = generateLevel(rng, depth, run ?? newRunState());
    const items = resolveItemSpawns(rng, depth, result.items);
    for (const it of items) result.level.items.push(it);
    stashGenResult(result.level, result);
    return result.level;
  },
};
