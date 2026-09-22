/**
 * Hero view-model: a read-only projection of the live Game hero for the UI.
 *
 * SPEC contract §6: the UI reads the central Game state and never duplicates
 * it. This module does structural reads (no copies kept) so it works with
 * the engine's HeroActor seam today and the mechanics Hero class when it
 * lands (src/mechanics/char.ts Hero: buffs['hunger'].left holds the hunger
 * level, weapon/armor/darts hold the warrior kit).
 */
import type { Game } from '../engine/loop.js';
import type { Hero } from '../mechanics/char.js';
import { maxExp } from '../mechanics/exp.js';
import { isHungry, isStarving } from '../mechanics/hunger.js';

export interface HeroView {
  hp: number;
  ht: number;
  lvl: number;
  exp: number;
  maxExp: number;
  str: number;
  /** Hunger level (0..360+); 0 when the hero has no hunger buff state. */
  hunger: number;
  hungry: boolean;
  starving: boolean;
  gold: number;
  /** Active buff kinds, e.g. 'burning', 'poison', 'ooze'. */
  buffs: string[];
  /** Hero display name. */
  name: string;
  /** Cell index of the hero (pos = y*w + x). */
  pos: number;
}

/** Structural read of the mechanics Hero fields the UI needs. */
function asHero(game: Game): Partial<Hero> & { gold?: number } {
  return game.hero as unknown as Partial<Hero> & { gold?: number };
}

export function readHeroView(game: Game): HeroView {
  const h = asHero(game);
  const hunger = h.buffs?.['hunger']?.left ?? 0;
  const buffs = h.buffs ? Object.keys(h.buffs) : [];
  const lvl = h.lvl ?? 1;
  return {
    hp: Math.max(0, game.hero.hp),
    ht: Math.max(1, game.hero.ht),
    lvl,
    exp: h.exp ?? 0,
    maxExp: maxExp(lvl),
    str: h.str ?? 10,
    hunger,
    hungry: isHungry(hunger),
    starving: isStarving(hunger),
    gold: h.gold ?? 0,
    buffs,
    name: game.hero.name || 'you',
    pos: game.hero.y * game.level.w + game.hero.x,
  };
}

/** Short buff label for HUD badges. */
export function buffLabel(kind: string): string {
  switch (kind) {
    case 'burning':
      return 'Burning';
    case 'poison':
      return 'Poisoned';
    case 'ooze':
      return 'Oozed';
    case 'paralysis':
      return 'Paralysed';
    case 'roots':
      return 'Rooted';
    case 'hunger':
      return 'Hunger';
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}
