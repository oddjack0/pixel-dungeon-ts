import { Terrain } from '../core/grid.js';
import type { PainterCtx } from './painters.js';
import {
  DoorType,
  entranceDoor,
  randomRoomCell,
  roomH,
  roomW,
  upgradeDoor,
  type Room,
} from './rooms.js';

/**
 * Faithful port of vanilla `levels/painters/ShopPainter.java` (GPL-3.0,
 * (C) Oleg Dolya): paints the shop room terrain, places the shop stock as
 * Heap.Type.FOR_SALE heaps, and spawns the Shopkeeper NPC.
 *
 * Called by the level generator for RoomType.SHOP rooms (vanilla assigns
 * shops on depths 6, 11, 16, 21 — see RegularLevel.assignRoomType).
 *
 * Terrain contract: vanilla fills the interior with Terrain.EMPTY_SP; this
 * port's shared Terrain enum carries EMPTY_SP as Terrain.WALKWAY (see
 * src/core/grid.ts) — the same convention the other special-room painters
 * use (painters.ts).
 *
 * Stock is emitted as ItemSpawn tags for the content designer to resolve
 * (the vanilla intent, e.g. 'quarterstaff'); the 'FOR_SALE' heap kind marks
 * shop stock (vanilla Heap.Type.FOR_SALE, ShopPainter.java:81).
 */
export function paintShopRoom(ctx: PainterCtx, room: Room): void {
  // ShopPainter.java:60-61 — fill( level, room, WALL ); fill( level, room, 1, EMPTY_SP );
  ctx.fillRoom(room, Terrain.WALL);
  ctx.fillRoomMargin(room, 1, Terrain.WALKWAY);

  const pasWidth = roomW(room) - 2; // ShopPainter.java:63 — room.width() - 2
  const pasHeight = roomH(room) - 2; // ShopPainter.java:64 — room.height() - 2
  const per = pasWidth * 2 + pasHeight * 2; // ShopPainter.java:65

  const stock = shopStock(ctx, ctx.depth); // ShopPainter.java:67 — range()

  // ShopPainter.java:69 — stock is centered on the entrance's perimeter index.
  const door = entranceDoor(room);
  const entrance = door
    ? { x: door.x, y: door.y }
    : { x: Math.floor((room.l + room.r) / 2), y: room.t };
  let pos = xy2p(pasWidth, pasHeight, room, entrance) + Math.floor((per - stock.length) / 2);

  for (const tag of stock) {
    // ShopPainter.java:72 — (pos + per) % per wraps the perimeter walk.
    const xy = p2xy(pasWidth, pasHeight, room, (((pos + per) % per) + per) % per);
    let cell = ctx.idx(xy.x, xy.y);

    // ShopPainter.java:74-79 — never stack two heaps on one cell; re-roll
    // the room interior until the cell is free.
    if (ctx.heaps.has(cell)) {
      let guard = 4096;
      do {
        const c = randomRoomCell(ctx.rng, room, 0);
        cell = ctx.idx(c.x, c.y);
      } while (ctx.heaps.has(cell) && guard-- > 0);
    }

    // ShopPainter.java:81 — level.drop( range[i], cell ).type = Heap.Type.FOR_SALE
    ctx.out.items.push({ pos: cell, heap: 'FOR_SALE', tag });
    ctx.heaps.add(cell);

    pos++;
  }

  placeShopkeeper(ctx, room); // ShopPainter.java:84

  // ShopPainter.java:86-88 — all connected doors become REGULAR
  // (monotonic Door.set; PainterCtx.paintDoorsRegular).
  for (const d of room.doors) upgradeDoor(d, DoorType.REGULAR);
}

/**
 * Vanilla `ShopPainter.range()` (ShopPainter.java:90-110): the stock list
 * per dungeon depth, shuffled. Emitted as content-designer tags (the
 * vanilla item each tag names is noted in the tag table below).
 *
 * Depth-6/11/16/21 weapons and armor are .identify()ed in vanilla
 * (ShopPainter.java:97-98, 102-103, 107-108, 113-119); potions and scrolls
 * are NOT identified — their shop price is the unidentified base
 * (Potion.price 20, Scroll.price 15).
 */
export function shopStock(ctx: PainterCtx, depth: number): string[] {
  const items: string[] = [];

  switch (depth) {
    // ShopPainter.java:96-100
    case 6:
      items.push(ctx.rng.int(0, 2) === 0 ? 'quarterstaff' : 'spear'); // identified
      items.push('leather-armor'); // identified
      items.push('seed-pouch');
      items.push('weightstone');
      break;
    // ShopPainter.java:101-105
    case 11:
      items.push(ctx.rng.int(0, 2) === 0 ? 'sword' : 'mace'); // identified
      items.push('mail-armor'); // identified
      items.push('scroll-holder');
      items.push('weightstone');
      break;
    // ShopPainter.java:106-110
    case 16:
      items.push(ctx.rng.int(0, 2) === 0 ? 'longsword' : 'battle-axe'); // identified
      items.push('scale-armor'); // identified
      items.push('wand-holster');
      items.push('weightstone');
      break;
    // ShopPainter.java:111-120
    case 21:
      switch (ctx.rng.int(0, 3)) {
        case 0:
          items.push('glaive'); // identified
          break;
        case 1:
          items.push('war-hammer'); // identified
          break;
        case 2:
          items.push('plate-armor'); // identified
          break;
      }
      items.push('torch');
      items.push('torch');
      break;
    default:
      break;
  }

  // ShopPainter.java:122-136 — the common stock, every shop.
  items.push('potion-of-healing'); // unidentified in vanilla
  for (let i = 0; i < 3; i++) items.push('random-potion'); // Generator.random(POTION)
  items.push('scroll-of-identify'); // unidentified in vanilla
  items.push('scroll-of-remove-curse'); // unidentified in vanilla
  items.push('scroll-of-magic-mapping'); // unidentified in vanilla
  items.push('random-scroll'); // Generator.random(SCROLL)
  items.push('overpriced-ration');
  items.push('overpriced-ration');
  items.push('ankh');

  ctx.rng.shuffle(items); // ShopPainter.java:138 — Random.shuffle( range )

  return items;
}

/**
 * Vanilla `ShopPainter.placeShopkeeper` (ShopPainter.java:142-160): a random
 * heap-free interior cell; ImpShopkeeper on the last shop level (depth 21),
 * plain Shopkeeper elsewhere. Depth 21 also floods the keeper's 3x3
 * neighborhood EMPTY_SP cells with WATER (ShopPainter.java:150-158).
 *
 * The mob-kind distinction for depth 21 (ImpShopkeeper) is left to the mob
 * resolver; the painter emits kind 'shopkeeper' either way and paints the
 * water moat itself since that is terrain.
 */
function placeShopkeeper(ctx: PainterCtx, room: Room): void {
  let pos: number;
  let guard = 4096;
  do {
    const c = randomRoomCell(ctx.rng, room, 0);
    pos = ctx.idx(c.x, c.y);
  } while (ctx.heaps.has(pos) && guard-- > 0);

  // ShopPainter.java:147-149
  ctx.out.mobs.push({ pos, kind: 'shopkeeper' });

  // ShopPainter.java:151-158 — `if (level instanceof LastShopLevel)`; in
  // vanilla the last shop level is depth 21.
  if (ctx.depth === 21) {
    const px = pos % ctx.width;
    const py = Math.floor(pos / ctx.width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= ctx.width || y >= ctx.height) continue;
        const i = ctx.idx(x, y);
        // ShopPainter.java:154 — `if (level.map[p] == Terrain.EMPTY_SP)`
        if (ctx.tiles[i] === Terrain.WALKWAY) ctx.tiles[i] = Terrain.WATER;
      }
    }
  }
}

/**
 * Vanilla `ShopPainter.xy2p` (ShopPainter.java:162-184): perimeter index of
 * a wall-ring cell, walking clockwise from the top-left interior corner.
 */
function xy2p(
  pasWidth: number,
  pasHeight: number,
  room: Room,
  xy: { x: number; y: number },
): number {
  if (xy.y === room.t) {
    return xy.x - room.l - 1;
  } else if (xy.x === room.r) {
    return xy.y - room.t - 1 + pasWidth;
  } else if (xy.y === room.b) {
    return room.r - xy.x - 1 + pasWidth + pasHeight;
  } else {
    // xy.x === room.l
    if (xy.y === room.t + 1) {
      return 0;
    }
    return room.b - xy.y - 1 + pasWidth * 2 + pasHeight;
  }
}

/**
 * Vanilla `ShopPainter.p2xy` (ShopPainter.java:186-203): inverse of xy2p —
 * perimeter index back to a wall-ring cell.
 */
function p2xy(
  pasWidth: number,
  pasHeight: number,
  room: Room,
  p: number,
): { x: number; y: number } {
  if (p < pasWidth) {
    return { x: room.l + 1 + p, y: room.t + 1 };
  } else if (p < pasWidth + pasHeight) {
    return { x: room.r - 1, y: room.t + 1 + (p - pasWidth) };
  } else if (p < pasWidth * 2 + pasHeight) {
    return { x: room.r - 1 - (p - (pasWidth + pasHeight)), y: room.b - 1 };
  } else {
    return { x: room.l + 1, y: room.b - 1 - (p - (pasWidth * 2 + pasHeight)) };
  }
}
