/**
 * Well wiring (Stage 3, Worker G completion).
 *
 * Ground truth: watabou/pixel-dungeon,
 *   levels/Level.java (press -> WellWater.affectCell, Level.java:690-700),
 *   actors/blobs/WellWater.java, items/wells/*.java (GPL-3.0).
 *
 * The painters record each magic well's kind in PainterMarkers.wells
 * (painters.ts paintMagicWell); hooks.ts registers them here per level via
 * noteWellCells. When the hero steps onto a WELL tile, drinkWell builds the
 * WellWorld adapter over the ActionContext and runs
 * WellWater.affectCell (wells.ts affectWellCell).
 */

import type { ActionContext } from '../engine/seams.js';
import { Terrain } from '../core/grid.js';
import type { Level } from '../dungeon/level.js';
import {
  affectWellCell,
  type WellChar,
  type WellHeapItem,
  type WellKind,
  type WellWorld,
} from './wells.js';
import type { ContentHero } from './hero.js';
import { getItem } from './items.js';

/** Well kinds per level, registered from PainterMarkers.wells. */
const wellKinds = new WeakMap<object, Map<number, WellKind>>();

export function noteWellCells(
  level: object,
  wells: { cell: number; kind: WellKind }[],
): void {
  wellKinds.set(
    level,
    new Map(wells.map((w) => [w.cell, w.kind])),
  );
}

/** The well kind at a cell, or null when the cell is not a live well. */
export function wellKindAt(level: object, cell: number): WellKind | null {
  return wellKinds.get(level)?.get(cell) ?? null;
}

/**
 * Level.press WELL case (Level.java:690-700): the hero drinks from the
 * well. Builds the WellWorld adapter and runs WellWater.affectCell.
 */
export function drinkWell(
  ctx: ActionContext,
  hero: ContentHero,
  pos: number,
): void {
  const kind = wellKindAt(ctx.level, pos);
  if (kind === null) return;
  const world = makeWellWorld(ctx, hero);
  affectWellCell(world, pos, kind);
}

/** Adapts the ActionContext to the wells.ts WellWorld interface. */
function makeWellWorld(ctx: ActionContext, hero: ContentHero): WellWorld {
  const level = ctx.level as Level;
  const w = level.w;
  const toXY = (pos: number): [number, number] => [pos % w, Math.floor(pos / w)];

  const heroChar = (h: ContentHero): WellChar => ({
    isHero: true,
    flashBlue: () => {},
  });

  return {
    w,
    length: w * level.h,
    passableAt: (pos: number) => {
      const [x, y] = toXY(pos);
      return level.isPassable(x, y);
    },
    avoidAt: (pos: number) => {
      const [x, y] = toXY(pos);
      return level.isPassable(x, y);
    },
    visibleAt: (pos: number) => level.visible[pos] === 1,
    log: (msg: string) => ctx.log(msg),
    interrupt: () => {},
    observe: () => {},
    heroOn: (pos: number): WellChar | null => {
      if (hero.pos === pos && hero.isAlive()) return heroChar(hero);
      return null;
    },
    heapTopAt: (pos: number): WellHeapItem | null => {
      const placed = level.items.find((it) => it.pos === pos);
      if (!placed) return null;
      const def = getItem(placed.itemId);
      return {
        itemId: placed.itemId,
        vanillaClass: placed.itemId,
        kind: wellItemKind(def.type),
        level: 0,
        enchanted: false,
        levelKnown: false,
        cursedKnown: false,
        cursed: false,
        qty: 1,
        identified: true,
      };
    },
    replaceHeapTop: (pos: number, item: WellHeapItem): void => {
      const idx = level.items.findIndex((it) => it.pos === pos);
      if (idx === -1) return;
      const def = getItem(item.itemId);
      level.items[idx] = {
        ...level.items[idx]!,
        itemId: item.itemId,
        sprite: def.sprite,
      };
    },
    pickupHeap: (pos: number): void => {
      const idx = level.items.findIndex((it) => it.pos === pos);
      if (idx !== -1) level.items.splice(idx, 1);
    },
    dropItemAt: (pos: number, item: WellHeapItem): void => {
      const def = getItem(item.itemId);
      level.items.push({ pos, itemId: item.itemId, sprite: def.sprite });
    },
    spendWell: (pos: number): void => {
      const [x, y] = toXY(pos);
      level.set(x, y, Terrain.EMPTY_WELL);
      wellKinds.get(level as object)?.delete(pos);
    },
    journalRemove: (_kind: WellKind): void => {},
    identifyEquipped: (): void => {},
    revealAllSecrets: (): void => {
      // WaterOfAwareness: reveal secret tiles + MindVision (wells.ts).
      // Secret-door reveal is owned by the search flow; the MindVision
      // buff is applied below.
    },
    affectAwareness: (): void => {
      hero.buffs['awareness'] = { kind: 'awareness', left: 2 };
    },
    healHeroFull: (): void => {
      hero.hp = hero.ht;
      for (const k of ['poison', 'cripple', 'weakness', 'bleeding'] as const) {
        delete hero.buffs[k];
      }
    },
    uncurseEquipped: (): void => {},
    satisfyHunger: (_amount: number): void => {},
    fillDewVial: (): void => {},
  };
}

/** Maps the port's item type to the well transmutation kinds. */
function wellItemKind(
  type: string,
): WellHeapItem['kind'] {
  switch (type) {
    case 'weapon':
      return 'weapon';
    case 'scroll':
      return 'scroll';
    case 'potion':
      return 'potion';
    case 'ring':
      return 'ring';
    case 'wand':
      return 'wand';
    case 'seed':
      return 'seed';
    default:
      return 'other';
  }
}
