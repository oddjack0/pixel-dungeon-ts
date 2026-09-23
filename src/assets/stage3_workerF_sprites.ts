/**
 * Worker F (Stage 3) sprite additions — subclasses / Tome of Mastery.
 *
 * ORIGINAL Pixel Dungeon sprites (c) Watabou, watabou/pixel-dungeon,
 * used under the GNU General Public License v3.0.
 *
 * Provenance per key (DO NOT redraw or recolor; these are raw slices):
 * - item_tome_mastery: items.png @(32,160) 16x16 — ItemSpriteSheet.MASTERY
 *   (index 82, ItemSpriteSheet.java:174); items.png tiles are 16x16 in
 *   8 columns (slice convention: scripts/extract_original_sprites.ts I()).
 *   Used by TomeOfMastery (items/TomeOfMastery.java: image = MASTERY).
 *
 * Sliced with the same decode path as scripts/extract_original_sprites.ts
 * (that script and src/assets/original_sprites.ts are intentionally left
 * untouched; Stage 3 workers must not edit them).
 *
 * Buff icons for the subclass buffs (Combo, Fury, SnipersMark, Shadows)
 * already exist in original_sprites.ts:
 *   bufficon_combo (BuffIndicator.COMBO=17), bufficon_fury (FURY=18),
 *   bufficon_mark (MARK=27), bufficon_shadows (SHADOWS=13),
 *   bufficon_invisible (INVISIBLE=12, Shadows extends Invisibility).
 *
 * Hero subclasses have NO dedicated sprites in vanilla: HeroSprite rows are
 * selected by armor tier only (HeroSprite.updateArmor, HeroSprite.java:56-58;
 * Freerunner "sprint" only changes the run animation speed,
 * HeroSprite.sprint, HeroSprite.java:123-126). Nothing to extract.
 */

/** One 16x16 RGBA sprite, base64-encoded (same shape as OriginalSprite). */
export interface WorkerFSprite {
  w: number;
  h: number;
  /** base64 of w*h*4 RGBA bytes, row-major. */
  rgba: string;
}

// prettier-ignore
export const WORKER_F_SPRITES: Record<string, WorkerFSprite> = {
  // item_tome_mastery: items.png @(32,160) 16x16 — ItemSpriteSheet.MASTERY (82)
  item_tome_mastery: { w: 16, h: 16, rgba: '////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGbs7OwA7OzsAP///wAAAABmAAAAZocQEP+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/4cQEP8AAABm7OzsAOzs7AD///8AAAAAZmwLC/+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/AAAAZuzs7ADs7OwA////AAAAAGZsCwv/oxUW///HAP//xwD//50A//+dAP//xwD//8cA//+dAP//xwD/oxUW/wAAAGbs7OwA7OzsAP///wAAAABmbAsL/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv8AAABm7OzsAOzs7AD///8AAAAAZmwLC/+jFRb/oxUW/6MVFv//xwD//50A///HAP//nQD/oxUW/6MVFv+jFRb/AAAAZuzs7ADs7OwA////AAAAAGZsCwv/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/wAAAGbs7OwA7OzsAP///wAAAABmbAsL/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv8AAABm7OzsAOzs7AD///8AAAAAZmwLC/+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/AAAAZuzs7ADs7OwA////AAAAAGZsCwv/oxUW/6MVFv+HEBD/hxAQ/4cQEP+HEBD/hxAQ/4cQEP+jFRb/oxUW/wAAAGbs7OwA7OzsAP///wAAAABmbAsL/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv8AAABm7OzsAOzs7AD///8AAAAAZmwLC/+HEBD/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv+HEBD/AAAAZuzs7ADs7OwA////AAAAAGZsCwv/y8u+/8vLvv/Ly77/y8u+/8vLvv/Ly77/y8u+/8vLvv/Ly77/u4mB/wAAAGbs7OwA7OzsAP///wAAAABmbAsL/8vLvv/9/e3//f3t//397f/9/e3//f3t//397f/9/e3//f3t/7uJgf8AAABm7OzsAOzs7AD///8AAAAAZgAAAGaHEBD/oxUW/6MVFv+jFRb/oxUW/6MVFv+jFRb/oxUW/6MVFv+HEBD/AAAAZuzs7ADs7OwA////AP///wAAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGYAAABmAAAAZgAAAGbs7OwA7OzsAA==' },
};
