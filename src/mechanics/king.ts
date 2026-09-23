/**
 * Dwarf King boss (depth 20) — pure stat constants and decision helpers.
 * Turn logic lives in src/content/king.ts.
 *
 * Ground truth: ~/workspace/pixel-dungeon-src actors/mobs/King.java.
 * Java wins every conflict.
 *
 * Stat constants (King.java:51-75):
 *   HP = HT = 300, EXP = 40, defenseSkill = 25, dr() = 14,
 *   damageRoll = NormalIntRange(20, 38) (King.java:82-84),
 *   attackSkill = 32, defenseVerb "parried", maxLvl default 30
 *   (Mob.java:69 — King does not override it).
 * Name: "King of Dwarves" when Dungeon.depth == Statistics.deepestFloor,
 * else "undead King of Dwarves" (King.java:55; deepestFloor tracking lands
 * with the meta systems — see kingDisplayName).
 *
 * Summoning (King.java:34, 116-192): MAX_ARMY_SIZE = 5;
 * maxArmySize() = 1 + MAX_ARMY_SIZE * (HT - HP) / HT (King.java:151-153,
 * Java int division). When the king acts with Undead.count < maxArmySize()
 * and is on its target pedestal, it summons maxArmySize() - Undead.count
 * undead dwarves on distance rings (King.java:116-192) — see
 * undeadSpawnCells for the exact ring loop.
 *
 * Undead (King$Undead, King.java:222-316): HP = HT = 28, defenseSkill = 15,
 * dr() = 5, damageRoll = NormalIntRange(12, 16), attackSkill = 16,
 * EXP = 0, state = WANDERING, defenseVerb "blocked". attackProc: 1/5 chance
 * to prolong Paralysis 1 (King.java:271-277). Immune to Death and Paralysis.
 */
import type { MechanicsRng } from './rng';

/** HP = HT = 300 (King.java:59). */
export const KING_HT = 300;
/** EXP = 40 (King.java:60). */
export const KING_EXP = 40;
/** defenseSkill = 25 (King.java:61). */
export const KING_DEFENSE = 25;
/** dr() = 14 (King.java:92-94). */
export const KING_DR = 14;
/** attackSkill = 32 (King.java:87-89). */
export const KING_ATTACK = 32;
/** damageRoll = NormalIntRange(20, 38) (King.java:82-84). */
export const KING_DMG_MIN = 20;
export const KING_DMG_MAX = 38;
/** King does not override maxLvl (Mob.java:69 default). */
export const KING_MAX_LVL = 30;
/**
 * King.MAX_ARMY_SIZE (King.java:34). maxArmySize() = 1 + 5*(HT-HP)/HT
 * (King.java:151-153): 1 at full HP, up to 6 when nearly dead.
 */
export const KING_MAX_ARMY_SIZE = 5;
/**
 * Source tags halved by the King's resistances (King.java:206-215).
 * Tag naming follows the codebase convention ('toxic_gas', 'death',
 * 'psionic_blast'; the wand-disruption tag is registered for the port's
 * disintegration zap to claim — no zap source uses it yet).
 */
export const KING_RESISTANCES = [
  'toxic_gas',
  'death',
  'psionic_blast',
  'disintegration',
] as const;
/** King's immunities: Paralysis, Vertigo (King.java:218-225). */
export const KING_IMMUNITIES = ['paralysis', 'vertigo'] as const;

/** Undead dwarf: HP = HT = 28 (King.java:232). */
export const UNDEAD_HT = 28;
/** Undead defenseSkill = 15 (King.java:233). */
export const UNDEAD_DEFENSE = 15;
/** Undead dr() = 5 (King.java:300-302). */
export const UNDEAD_DR = 5;
/** Undead attackSkill = 16 (King.java:266-268). */
export const UNDEAD_ATTACK = 16;
/** Undead damageRoll = NormalIntRange(12, 16) (King.java:261-263). */
export const UNDEAD_DMG_MIN = 12;
export const UNDEAD_DMG_MAX = 16;
/** Undead EXP = 0 (King.java:235). */
export const UNDEAD_EXP = 0;
/** Undead does not override maxLvl (Mob.java:69 default). */
export const UNDEAD_MAX_LVL = 30;
/** Undead's immunities: Death, Paralysis (King.java:310-316). */
export const UNDEAD_IMMUNITIES = ['death', 'paralysis'] as const;
/**
 * Undead.attackProc (King.java:271-277): 1/MAX_ARMY_SIZE chance to prolong
 * Paralysis for 1 turn. Reuses the army-size constant as the die size.
 */
export const UNDEAD_PARALYSIS_TURNS = 1;
export const UNDEAD_PARALYSIS_DIE = KING_MAX_ARMY_SIZE;

/** King damage die (King.damageRoll, King.java:82-84). */
export function kingDamageRoll(rng: MechanicsRng): number {
  return rng.normalIntRange(KING_DMG_MIN, KING_DMG_MAX);
}

/** Undead damage die (Undead.damageRoll, King.java:261-263). */
export function undeadDamageRoll(rng: MechanicsRng): number {
  return rng.normalIntRange(UNDEAD_DMG_MIN, UNDEAD_DMG_MAX);
}

/**
 * King.maxArmySize (King.java:151-153): 1 + MAX_ARMY_SIZE * (HT - HP) / HT
 * in Java int arithmetic (non-negative operands, so Math.floor matches).
 */
export function kingMaxArmySize(hp: number, ht: number): number {
  return 1 + Math.floor((KING_MAX_ARMY_SIZE * (ht - hp)) / ht);
}

/**
 * King.summon: number of undead to summon (King.java:168):
 * maxArmySize() - Undead.count.
 */
export function kingUndeadsToSummon(maxArmy: number, undeadCount: number): number {
  return maxArmy - undeadCount;
}

/**
 * King display name (King.java:55): "King of Dwarves" when the hero is
 * fighting at their deepest floor, else "undead King of Dwarves".
 * deepestFloor is null when the meta system hasn't recorded it yet; the
 * first descent to depth 20 is at the deepest floor, so null defaults to
 * the "King of Dwarves" name.
 */
export function kingDisplayName(
  depth: number,
  deepestFloor: number | null,
): string {
  return deepestFloor === null || depth === deepestFloor
    ? 'King of Dwarves'
    : 'undead King of Dwarves';
}

/**
 * King.summon ring scan (King.java:171-190), pure: given the BFS distance
 * map (from the king's cell over passable-minus-chars cells, with
 * distance[kingPos] set to Infinity — King.java:169-170), pick spawn cells
 * for `undeadsToSummon` undead. This is the exact Java loop:
 *
 *   int dist = 1;
 * undeadLabel:
 *   for (int i=0; i < undeadsToSummon; i++) {
 *     do {
 *       for (int j=0; j < Level.LENGTH; j++) {
 *         if (PathFinder.distance[j] == dist) {
 *           ... spawn at j ...;
 *           PathFinder.distance[j] = Integer.MAX_VALUE;
 *           continue undeadLabel;
 *         }
 *       }
 *       dist++;
 *     } while (dist < undeadsToSummon);
 *   }
 *
 * Quirks preserved: cells are claimed in index order per ring; when no cell
 * exists at distance d, d grows past undeadsToSummon and later outer
 * iterations still run the do-body once (do-while), scanning for the new d.
 * Spawn count can therefore be smaller than undeadsToSummon when the arena
 * has few reachable rings.
 */
export function undeadSpawnCells(
  distance: ArrayLike<number>,
  length: number,
  undeadsToSummon: number,
): number[] {
  const dist: number[] = Array.from({ length }, (_, j) => distance[j]);
  const cells: number[] = [];
  let d = 1;
undeadLabel:
  for (let i = 0; i < undeadsToSummon; i++) {
    do {
      for (let j = 0; j < length; j++) {
        if (dist[j] === d) {
          cells.push(j);
          dist[j] = Infinity; // Integer.MAX_VALUE in Java
          continue undeadLabel;
        }
      }
      d++;
    } while (d < undeadsToSummon);
  }
  return cells;
}

/**
 * Pedestal registry. CityBossLevel.pedestal(boolean) (CityBossLevel.java:137-143)
 * is a pure function of the generation constants (TOP, HALL_HEIGHT, WIDTH,
 * CENTER): left = (TOP + HALL_HEIGHT/2)*WIDTH + CENTER - 2, right = + 2.
 * The City boss level worker owns generation and registers the two pedestal
 * cells here; King's AI reads them (King.java:96-115).
 */
let pedestalLeft = -1;
let pedestalRight = -1;

/** Registered by the City boss level worker at generation time. */
export function setKingPedestals(left: number, right: number): void {
  pedestalLeft = left;
  pedestalRight = right;
}

/**
 * CityBossLevel.pedestal(first) (CityBossLevel.java:137-143): first=true
 * (King.nextPedestal starts true, King.java:66) is the left/CENTER-2 one.
 */
export function kingPedestal(first: boolean): number {
  return first ? pedestalLeft : pedestalRight;
}

/** Reset pedestal state (level reload in tests). */
export function resetKingPedestals(): void {
  pedestalLeft = -1;
  pedestalRight = -1;
}
