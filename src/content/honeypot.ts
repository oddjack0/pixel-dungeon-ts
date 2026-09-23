/**
 * Honeypot (GPL-3.0; ground truth: watabou/pixel-dungeon,
 * `items/Honeypot.java`).
 *
 * - name "honeypot", stackable, default action THROW (Honeypot.java:50-57);
 *   actions: SHATTER + inherited throw/drop.
 * - execute SHATTER: shatter at the hero's own cell, detach, spend
 *   TIME_TO_THROW = 1 (Honeypot.java:61-73).
 * - onThrow(cell): pit/chasm -> drop intact (Item.onThrow); otherwise
 *   shatter at the cell (Honeypot.java:76-82).
 * - shatter(pos): if a char stands on pos, the bee moves to a random
 *   free passable 4-neighbour (or nowhere if none); a new Bee spawns
 *   with full HP at the chosen cell (Honeypot.java:84-113).
 * - Always identified, not upgradable, price 50 * qty
 *   (Honeypot.java:115-133).
 *
 * Bee seam: the bee worker (bee.ts) implements the Bee mob + ally AI and
 * registers it via `setSummonBee` at module load.
 */
import type { ActionContext } from '../engine/seams.js';
import { Terrain } from '../core/grid.js';
import { dropItemAt } from './mobs.js';
import { takeFromSlot } from './potions.js';
import type { ContentHero } from './hero.js';
import type { ItemDef } from './items.js';

export const HONEYPOT_ID = 'honeypot';

/** TIME_TO_THROW = 1 (Item.java:68). */
export const HONEYPOT_THROW_TIME = 1;

export const HONEYPOT_DEF: ItemDef = {
  id: HONEYPOT_ID,
  name: 'honeypot',
  sprite: 'item_honeypot',
  type: 'misc',
  stackable: true,
  // Honeypot.java info()
  desc: "There is not much honey in this small honeypot, but there is a golden bee there and it doesn't want to leave it.",
  /** price() = 50 * quantity (Honeypot.java:129-131): 50 per unit. */
  price: 50,
};

// ---------------------------------------------------------------------------
// Bee seam (Worker 2)
// ---------------------------------------------------------------------------

/**
 * Spawn an allied Bee at `cell`, owned by the bee worker (bee.ts). The bee
 * worker calls `setSummonBee` with its implementation at module load.
 */
let summonBeeImpl: ((ctx: ActionContext, cell: number) => void) | null = null;

export function setSummonBee(fn: (ctx: ActionContext, cell: number) => void): void {
  summonBeeImpl = fn;
}

/** True once the bee worker has registered the Bee spawner. */
export function beeSpawnerRegistered(): boolean {
  return summonBeeImpl !== null;
}

// ---------------------------------------------------------------------------
// Shatter
// ---------------------------------------------------------------------------

/**
 * Honeypot.shatter(pos) (Honeypot.java:84-113): pick the bee's cell —
 * `pos` unless occupied, in which case a random free passable
 * 4-neighbour (none -> no bee) — then spawn the Bee at full HP.
 */
export function shatterHoneypotAt(
  ctx: ActionContext,
  hero: ContentHero,
  cell: number,
): void {
  const w = ctx.level.w;
  const occupied = (c: number): boolean => {
    if (hero.pos === c) return true;
    for (const m of ctx.mobs) {
      if (m.isAlive() && m.y * w + m.x === c) return true;
    }
    return false;
  };
  let newPos = cell;
  if (occupied(cell)) {
    const candidates: number[] = [];
    const cx = cell % w;
    const cy = Math.floor(cell / w);
    // Level.NEIGHBOURS4 (Honeypot.java:93-99): passable + no char.
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!ctx.level.inBounds(nx, ny)) continue;
      if (!ctx.level.isPassable(nx, ny)) continue;
      const c = ny * w + nx;
      if (!occupied(c)) candidates.push(c);
    }
    newPos = candidates.length > 0 ? ctx.rng.pick(candidates) : -1;
  }
  if (newPos !== -1 && summonBeeImpl) {
    summonBeeImpl(ctx, newPos);
  }
  // Without the bee spawner the pot still shatters (consumed by the
  // caller); the missing bee is a known gap, not a silent bug — see the
  // worker report.
}

/**
 * Honeypot.execute SHATTER (Honeypot.java:61-73): shatter at the hero's
 * feet, detach one, spend TIME_TO_THROW.
 */
export function shatterHoneypotInHands(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
): number {
  const stack = hero.inventory[slot];
  if (!stack || stack.itemId !== HONEYPOT_ID) {
    ctx.log('Nothing in that slot.');
    return 1;
  }
  shatterHoneypotAt(ctx, hero, hero.pos);
  takeFromSlot(hero, slot, 1);
  return HONEYPOT_THROW_TIME;
}

/**
 * Honeypot.onThrow (Honeypot.java:76-82): thrown into a pit/chasm the pot
 * survives (Item.onThrow drops it); otherwise it shatters at the cell.
 * The caller detaches first (Item.java:574-578: detach().onThrow(cell)).
 */
export function throwHoneypot(
  ctx: ActionContext,
  hero: ContentHero,
  slot: number,
  cell: number,
): number {
  const stack = hero.inventory[slot];
  if (!stack || stack.itemId !== HONEYPOT_ID) {
    ctx.log('Nothing in that slot.');
    return 1;
  }
  takeFromSlot(hero, slot, 1);
  const x = cell % ctx.level.w;
  const y = Math.floor(cell / ctx.level.w);
  const tile = ctx.level.get(x, y);
  if (tile === Terrain.CHASM) {
    dropItemAt(ctx, cell, HONEYPOT_ID);
  } else {
    shatterHoneypotAt(ctx, hero, cell);
  }
  return HONEYPOT_THROW_TIME;
}
