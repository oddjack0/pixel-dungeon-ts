/**
 * Ring static specs — mechanics-level data (no content dependencies).
 *
 * Ground truth: ~/workspace/pixel-dungeon-src (Ring.java `rings` array
 * order + each RingOf*.java class). Java wins every conflict.
 *
 * Moved here from content/rings.ts so the item catalog (content/items.ts)
 * can build base ring defs without a content->content import cycle
 * (rings.ts imports items.ts for getItem). Mirrors WAND_SPECS in
 * mechanics/wands.ts.
 */
import type { BuffKind } from './buffs.js';

/** Static definition of one of the 12 rings (Ring.java class order). */
export interface RingSpec {
  id: string;
  javaClass: string;
  name: string;
  desc: string;
  /** Original sprite key in src/assets/original_sprites.ts. */
  spriteKey: string;
  /** Buff kind attached while equipped. */
  buffKind: BuffKind;
  /** Haggler/Thorns: fixed +1, identified on pickup, not upgradable. */
  fixedPlusOne?: boolean;
}

/**
 * The 12 rings in Ring.java `rings` array order, with exact names and
 * descriptions from each ring class.
 */
export const RING_SPECS: RingSpec[] = [
  {
    id: 'mending',
    javaClass: 'RingOfMending',
    name: 'Ring of Mending',
    desc:
      "This ring increases the body's regenerative properties, allowing " +
      'one to recover lost health at an accelerated rate. Degraded rings will ' +
      "decrease or even halt one's natural regeneration.",
    spriteKey: 'item_ring_mending',
    buffKind: 'ring_mending',
  },
  {
    id: 'detection',
    javaClass: 'RingOfDetection',
    name: 'Ring of Detection',
    desc:
      'Wearing this ring will allow the wearer to notice hidden secrets - ' +
      'traps and secret doors - without taking time to search. Degraded rings of detection ' +
      'will dull your senses, making it harder to notice secrets even when actively searching for them.',
    spriteKey: 'item_ring_detection',
    buffKind: 'ring_detection',
  },
  {
    id: 'shadows',
    javaClass: 'RingOfShadows',
    name: 'Ring of Shadows',
    desc:
      'Enemies will be less likely to notice you if you wear this ring. Degraded rings ' +
      'of shadows will alert enemies who might otherwise not have noticed your presence.',
    spriteKey: 'item_ring_shadows',
    buffKind: 'ring_shadows',
  },
  {
    id: 'power',
    javaClass: 'RingOfPower',
    name: 'Ring of Power',
    desc:
      'Your wands will become more powerful in the energy field ' +
      'that radiates from this ring. Degraded rings of power will instead weaken your wands.',
    spriteKey: 'item_ring_power',
    buffKind: 'ring_power',
  },
  {
    id: 'herbalism',
    javaClass: 'RingOfHerbalism',
    name: 'Ring of Herbalism',
    desc: 'This ring increases your chance to gather dew and seeds from trampled grass.',
    spriteKey: 'item_ring_herbalism',
    buffKind: 'ring_herbalism',
  },
  {
    id: 'accuracy',
    javaClass: 'RingOfAccuracy',
    name: 'Ring of Accuracy',
    desc: 'This ring increases your chance to hit the enemy.',
    spriteKey: 'item_ring_accuracy',
    buffKind: 'ring_accuracy',
  },
  {
    id: 'evasion',
    javaClass: 'RingOfEvasion',
    name: 'Ring of Evasion',
    desc: 'This ring increases your chance to dodge enemy attack.',
    spriteKey: 'item_ring_evasion',
    buffKind: 'ring_evasion',
  },
  {
    id: 'satiety',
    javaClass: 'RingOfSatiety',
    name: 'Ring of Satiety',
    desc:
      'Wearing this ring you can go without food longer. Degraded rings of satiety will cause the opposite effect.',
    spriteKey: 'item_ring_satiety',
    buffKind: 'ring_satiety',
  },
  {
    id: 'haste',
    javaClass: 'RingOfHaste',
    name: 'Ring of Haste',
    desc:
      "This ring accelerates the wearer's flow of time, allowing one to perform all actions a little faster.",
    spriteKey: 'item_ring_haste',
    buffKind: 'ring_haste',
  },
  {
    id: 'haggler',
    javaClass: 'RingOfHaggler',
    name: 'Ring of Haggler',
    desc:
      "In fact this ring doesn't provide any magic effect, but it demonstrates " +
      'to shopkeepers and vendors, that the owner of the ring is a member of ' +
      "The Thieves' Guild. Usually they are glad to give a discount in exchange " +
      "for temporary immunity guarantee. Upgrading this ring won't give any additional " +
      'bonuses.',
    spriteKey: 'item_ring_haggler',
    buffKind: 'ring_haggler',
    fixedPlusOne: true,
  },
  {
    id: 'elements',
    javaClass: 'RingOfElements',
    name: 'Ring of Elements',
    desc:
      'This ring provides resistance to different elements, such as fire, ' +
      'electricity, gases etc. Also it decreases duration of negative effects.',
    spriteKey: 'item_ring_elements',
    buffKind: 'ring_elements',
  },
  {
    id: 'thorns',
    javaClass: 'RingOfThorns',
    name: 'Ring of Thorns',
    desc:
      "Though this ring doesn't provide real thorns, an enemy that attacks you " +
      'will itself be wounded by a fraction of the damage that it inflicts. ' +
      "Upgrading this ring won't give any additional bonuses.",
    spriteKey: 'item_ring_thorns',
    buffKind: 'ring_thorns',
    fixedPlusOne: true,
  },
];
