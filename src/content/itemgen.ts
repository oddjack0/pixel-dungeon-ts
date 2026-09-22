/**
 * Vanilla item Generator (items/Generator.java), ported exactly and mapped
 * onto the M1 item catalog.
 *
 * Ground truth: Generator.java:38-131 (GPL-3.0, (C) 2012-2015 Oleg Dolya).
 * Java wins every conflict.
 *
 * What is exact:
 *   - Category base weights (Generator.java:38-48):
 *       WEAPON 15, ARMOR 10, POTION 50, SCROLL 40, WAND 4, RING 2,
 *       SEED 5, FOOD 0, GOLD 50, MISC 5.
 *   - Within-category class weights (the static initializer,
 *     Generator.java:66-97), in the exact class order listed there.
 *   - Draw mechanics: Generator.random() picks a category by
 *     Random.chances(categoryProbs) and HALVES that category's weight
 *     (Generator.java:105-107, 113); Generator.random(Category) halves
 *     then draws the class (Generator.java:109-131). categoryProbs is
 *     reset to the base weights once per depth (InterlevelScene.java:116,
 *     on descend) and is NOT serialized (static, survives save/load
 *     in-memory — the port's module-level bag behaves the same).
 *   - Sized quantities: Gold.random() = Random.Int(20 + depth*10,
 *     40 + depth*20) — [min, max) (Gold.java:100-103); Dart/Javelin/Shuriken
 *     Random.Int(5, 15), IncendiaryDart Random.Int(3, 6), CurareDart
 *     Random.Int(2, 5), Tamahawk Random.Int(5, 12) (missiles/*.java).
 *
 * M1 adaptations (documented, distribution-preserving):
 *   - The M1 catalog has one melee weapon (shortsword), one missile (dart),
 *     one armor (cloth armor), two potions, two scrolls, one food, gold.
 *     Each drawn vanilla class maps to its catalog analog:
 *       melee weapon classes -> 'shortsword'; missile classes -> 'dart:<qty>'
 *         with the DRAWN class's exact quantity range;
 *       armor classes -> 'cloth_armor';
 *       potion classes -> 'potion_healing' (strength/might have weight 0 and
 *         never draw; M1 has no unidentified-potion variety);
 *       scroll classes -> 'scroll_<id>'; wand classes -> 'wand_of_<id>';
 *       ring classes -> 'ring_of_<id>';
 *       seed classes -> 'ration'; bomb -> 'dart:<5..15>'; honeypot ->
 *         'potion_healing'.
 *   - Weapon levels: Weapon.random() can upgrade/degrade (Weapon.java:181-196)
 *     and Skeleton.dropLoot keeps the lowest-level of 3 draws
 *     (Skeleton.java:78-88). M1 has no weapon-level mechanics (all catalog
 *     weapons are level 0), so the best-of-3 comparison always keeps the
 *     first draw; the loop is kept structurally faithful.
 *   - Category pick order: vanilla iterates a HashMap (JVM-hash order, not
 *     replicable); the port walks the enum declaration order
 *     (Generator.java:38-48). The resulting distribution is identical; only
 *     the per-draw RNG-stream alignment differs.
 */
import type { MechanicsRng } from '../mechanics/rng.js';

export type GenCategory =
  | 'weapon'
  | 'armor'
  | 'potion'
  | 'scroll'
  | 'wand'
  | 'ring'
  | 'seed'
  | 'food'
  | 'gold'
  | 'misc';

/** Base category weights, enum declaration order (Generator.java:38-48). */
export const GEN_CATEGORY_WEIGHTS: ReadonlyArray<{
  cat: GenCategory;
  weight: number;
}> = [
  { cat: 'weapon', weight: 15 },
  { cat: 'armor', weight: 10 },
  { cat: 'potion', weight: 50 },
  { cat: 'scroll', weight: 40 },
  { cat: 'wand', weight: 4 },
  { cat: 'ring', weight: 2 },
  { cat: 'seed', weight: 5 },
  { cat: 'food', weight: 0 },
  { cat: 'gold', weight: 50 },
  { cat: 'misc', weight: 5 },
];

interface GenClass {
  /** Vanilla class name, static-block order (Generator.java:66-97). */
  cls: string;
  /** Within-category selection weight. */
  prob: number;
  /** M1 catalog item id (may encode a quantity, e.g. 'dart:7'). */
  m1: (rng: MechanicsRng, depth: number) => string;
}

const dart =
  (min: number, max: number): GenClass['m1'] =>
  (rng) =>
    `dart:${rng.int(min, max)}`;
const shortsword: GenClass['m1'] = () => 'shortsword';

const GEN_CLASSES: Record<GenCategory, ReadonlyArray<GenClass>> = {
  // Generator.java:70-88 — WEAPON.probs: 1,1,1,1,1,1,1,1,1,1,0,0,1,1,1,1,0,1
  weapon: [
    { cls: 'Dagger', prob: 1, m1: shortsword },
    { cls: 'Knuckles', prob: 1, m1: shortsword },
    { cls: 'Quarterstaff', prob: 1, m1: shortsword },
    { cls: 'Spear', prob: 1, m1: shortsword },
    { cls: 'Mace', prob: 1, m1: shortsword },
    { cls: 'Sword', prob: 1, m1: shortsword },
    { cls: 'Longsword', prob: 1, m1: shortsword },
    { cls: 'BattleAxe', prob: 1, m1: shortsword },
    { cls: 'WarHammer', prob: 1, m1: shortsword },
    { cls: 'Glaive', prob: 1, m1: shortsword },
    { cls: 'ShortSword', prob: 0, m1: shortsword },
    { cls: 'Dart', prob: 0, m1: dart(5, 15) },
    { cls: 'Javelin', prob: 1, m1: dart(5, 15) }, // Javelin.java:70
    { cls: 'IncendiaryDart', prob: 1, m1: dart(3, 6) }, // IncendiaryDart.java:92
    { cls: 'CurareDart', prob: 1, m1: dart(2, 5) }, // CurareDart.java:72
    { cls: 'Shuriken', prob: 1, m1: dart(5, 15) }, // Shuriken.java:63
    { cls: 'Boomerang', prob: 0, m1: dart(5, 15) },
    { cls: 'Tamahawk', prob: 1, m1: dart(5, 12) }, // Tamahawk.java:70
  ],
  // Generator.java: ARMOR.probs = 1,1,1,1,1
  armor: [
    { cls: 'ClothArmor', prob: 1, m1: () => 'cloth_armor' },
    { cls: 'LeatherArmor', prob: 1, m1: () => 'cloth_armor' },
    { cls: 'MailArmor', prob: 1, m1: () => 'cloth_armor' },
    { cls: 'ScaleArmor', prob: 1, m1: () => 'cloth_armor' },
    { cls: 'PlateArmor', prob: 1, m1: () => 'cloth_armor' },
  ],
  // Generator.java: POTION.probs = 45,4,15,10,15,10,0,20,12,10,0,10
  // Stage 2 (Worker 4): every class maps to its real catalog id.
  potion: [
    { cls: 'PotionOfHealing', prob: 45, m1: () => 'potion_healing' },
    { cls: 'PotionOfExperience', prob: 4, m1: () => 'potion_experience' },
    { cls: 'PotionOfToxicGas', prob: 15, m1: () => 'potion_toxicgas' },
    { cls: 'PotionOfParalyticGas', prob: 10, m1: () => 'potion_paralyticgas' },
    { cls: 'PotionOfLiquidFlame', prob: 15, m1: () => 'potion_liquidflame' },
    { cls: 'PotionOfLevitation', prob: 10, m1: () => 'potion_levitation' },
    { cls: 'PotionOfStrength', prob: 0, m1: () => 'potion_strength' },
    { cls: 'PotionOfMindVision', prob: 20, m1: () => 'potion_mindvision' },
    { cls: 'PotionOfPurity', prob: 12, m1: () => 'potion_purity' },
    { cls: 'PotionOfInvisibility', prob: 10, m1: () => 'potion_invisibility' },
    { cls: 'PotionOfMight', prob: 0, m1: () => 'potion_might' },
    { cls: 'PotionOfFrost', prob: 10, m1: () => 'potion_frost' },
  ],
  // Generator.java: SCROLL.probs = 30,10,15,10,15,12,8,8,4,6,0,1
  // Stage 2 (Worker 4): every class maps to its real catalog id.
  scroll: [
    { cls: 'ScrollOfIdentify', prob: 30, m1: () => 'scroll_identify' },
    { cls: 'ScrollOfTeleportation', prob: 10, m1: () => 'scroll_teleportation' },
    { cls: 'ScrollOfRemoveCurse', prob: 15, m1: () => 'scroll_removecurse' },
    { cls: 'ScrollOfRecharging', prob: 10, m1: () => 'scroll_recharging' },
    { cls: 'ScrollOfMagicMapping', prob: 15, m1: () => 'scroll_magicmapping' },
    { cls: 'ScrollOfChallenge', prob: 12, m1: () => 'scroll_challenge' },
    { cls: 'ScrollOfTerror', prob: 8, m1: () => 'scroll_terror' },
    { cls: 'ScrollOfLullaby', prob: 8, m1: () => 'scroll_lullaby' },
    { cls: 'ScrollOfPsionicBlast', prob: 4, m1: () => 'scroll_psionicblast' },
    { cls: 'ScrollOfMirrorImage', prob: 6, m1: () => 'scroll_mirrorimage' },
    { cls: 'ScrollOfUpgrade', prob: 0, m1: () => 'scroll_upgrade' },
    { cls: 'ScrollOfEnchantment', prob: 1, m1: () => 'scroll' },
  ],
  // Generator.java: WAND.probs = 10,10,15,6,10,11,15,10,6,10,0,5,5
  wand: [
    { cls: 'WandOfTeleportation', prob: 10, m1: () => 'wand_of_teleportation' },
    { cls: 'WandOfSlowness', prob: 10, m1: () => 'wand_of_slowness' },
    { cls: 'WandOfFirebolt', prob: 15, m1: () => 'wand_of_firebolt' },
    { cls: 'WandOfRegrowth', prob: 6, m1: () => 'wand_of_regrowth' },
    { cls: 'WandOfPoison', prob: 10, m1: () => 'wand_of_poison' },
    { cls: 'WandOfBlink', prob: 11, m1: () => 'wand_of_blink' },
    { cls: 'WandOfLightning', prob: 15, m1: () => 'wand_of_lightning' },
    { cls: 'WandOfAmok', prob: 10, m1: () => 'wand_of_amok' },
    { cls: 'WandOfReach', prob: 6, m1: () => 'wand_of_reach' },
    { cls: 'WandOfFlock', prob: 10, m1: () => 'wand_of_flock' },
    { cls: 'WandOfMagicMissile', prob: 0, m1: () => 'wand_of_magic_missile' },
    { cls: 'WandOfDisintegration', prob: 5, m1: () => 'wand_of_disintegration' },
    { cls: 'WandOfAvalanche', prob: 5, m1: () => 'wand_of_avalanche' },
  ],
  // Generator.java: RING.probs = 1,1,1,1,1,1,1,1,1,1,0,0
  ring: [
    { cls: 'RingOfMending', prob: 1, m1: () => 'ring_of_mending' },
    { cls: 'RingOfDetection', prob: 1, m1: () => 'ring_of_detection' },
    { cls: 'RingOfShadows', prob: 1, m1: () => 'ring_of_shadows' },
    { cls: 'RingOfPower', prob: 1, m1: () => 'ring_of_power' },
    { cls: 'RingOfHerbalism', prob: 1, m1: () => 'ring_of_herbalism' },
    { cls: 'RingOfAccuracy', prob: 1, m1: () => 'ring_of_accuracy' },
    { cls: 'RingOfEvasion', prob: 1, m1: () => 'ring_of_evasion' },
    { cls: 'RingOfSatiety', prob: 1, m1: () => 'ring_of_satiety' },
    { cls: 'RingOfHaste', prob: 1, m1: () => 'ring_of_haste' },
    { cls: 'RingOfElements', prob: 1, m1: () => 'ring_of_elements' },
    { cls: 'RingOfHaggler', prob: 0, m1: () => 'ring_of_haggler' },
    { cls: 'RingOfThorns', prob: 0, m1: () => 'ring_of_thorns' },
  ],
  // Generator.java: SEED.probs = 1,1,1,1,1,1,1,0
  seed: [
    { cls: 'Firebloom.Seed', prob: 1, m1: () => 'ration' },
    { cls: 'Icecap.Seed', prob: 1, m1: () => 'ration' },
    { cls: 'Sorrowmoss.Seed', prob: 1, m1: () => 'ration' },
    { cls: 'Dreamweed.Seed', prob: 1, m1: () => 'ration' },
    { cls: 'Sungrass.Seed', prob: 1, m1: () => 'ration' },
    { cls: 'Earthroot.Seed', prob: 1, m1: () => 'ration' },
    { cls: 'Fadeleaf.Seed', prob: 1, m1: () => 'ration' },
    { cls: 'Rotberry.Seed', prob: 0, m1: () => 'ration' },
  ],
  // Generator.java: FOOD.probs = 4,1,0 — category weight 0, never drawn via
  // random(); kept for completeness (Level.java:162 draws it directly).
  food: [
    { cls: 'Food', prob: 4, m1: () => 'ration' },
    { cls: 'Pasty', prob: 1, m1: () => 'ration' },
    { cls: 'MysteryMeat', prob: 0, m1: () => 'ration' },
  ],
  // Generator.java: GOLD.probs = 1
  gold: [
    {
      cls: 'Gold',
      prob: 1,
      m1: (rng, depth) => `gold:${rng.int(20 + depth * 10, 40 + depth * 20)}`,
    },
  ],
  // Generator.java: MISC.probs = 2,1
  misc: [
    { cls: 'Bomb', prob: 2, m1: dart(5, 15) },
    { cls: 'Honeypot', prob: 1, m1: () => 'honeypot' },
  ],
};

/**
 * Weighted pick (Random.chances, float[] overload): first entry whose
 * cumulative weight exceeds a [0, total) roll. Falls back to the last
 * entry on float rounding (same guard as the port's pickMobId).
 */
function chances<T>(rng: MechanicsRng, entries: ReadonlyArray<T>, weight: (e: T) => number): T {
  let total = 0;
  for (const e of entries) total += weight(e);
  const roll = rng.float(0, total);
  let acc = 0;
  for (const e of entries) {
    acc += weight(e);
    if (roll < acc) return e;
  }
  return entries[entries.length - 1]!;
}

/**
 * The per-depth Generator state: categoryProbs (Generator.java:64).
 * One bag is shared by level-gen draws and mob-loot draws within a depth,
 * exactly like vanilla's static map; reset on depth entry
 * (InterlevelScene.java:116).
 */
export class GeneratorBag {
  private readonly weights = new Map<GenCategory, number>();

  constructor() {
    this.reset();
  }

  /** Generator.reset() (Generator.java:99-103). */
  reset(): void {
    for (const { cat, weight } of GEN_CATEGORY_WEIGHTS) {
      this.weights.set(cat, weight);
    }
  }

  /** Current weight of a category (test hook). */
  weightOf(cat: GenCategory): number {
    return this.weights.get(cat)!;
  }

  /**
   * Generator.random() (Generator.java:105-107): pick a category by current
   * weights, halve that category's weight, draw a class from it.
   */
  random(rng: MechanicsRng, depth: number): string {
    const cat = chances(rng, GEN_CATEGORY_WEIGHTS, (e) => this.weights.get(e.cat)!).cat;
    return this.randomFrom(rng, cat, depth);
  }

  /**
   * Generator.random(Category) (Generator.java:109-131): halve the
   * category's weight, then draw a class by the static class probs.
   */
  randomFrom(rng: MechanicsRng, cat: GenCategory, depth: number): string {
    this.weights.set(cat, this.weights.get(cat)! / 2);
    const cls = chances(rng, GEN_CLASSES[cat], (e) => e.prob);
    return cls.m1(rng, depth);
  }
}

/**
 * Skeleton.dropLoot weapon pick (Skeleton.java:78-88): three
 * Generator.random(WEAPON) draws, keeping the one with the lowest level().
 * Each draw halves the shared WEAPON weight (Generator.java:113), so the
 * bag is threaded through.
 */
export function skeletonWeaponDrop(
  rng: MechanicsRng,
  depth: number,
  bag: GeneratorBag,
): string {
  let best = '';
  let bestLvl = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const id = bag.randomFrom(rng, 'weapon', depth);
    // M1 catalog weapons are all level 0 (no Weapon.random() level rolls),
    // so the strictly-less comparison keeps the first draw — the loop is
    // kept structurally faithful to Skeleton.java:80-86.
    const lvl = 0;
    if (lvl < bestLvl) {
      best = id;
      bestLvl = lvl;
    }
  }
  return best;
}

/**
 * The run's shared Generator state (Generator.categoryProbs). Reset on
 * depth entry by the content level generator (spawns.ts), mirroring
 * InterlevelScene.java:116. Like vanilla's static map it is NOT
 * serialized — in-memory only.
 */
export const itemGenerator = new GeneratorBag();

/** Reset the shared Generator weights (depth entry). */
export function resetItemGenerator(): void {
  itemGenerator.reset();
}
