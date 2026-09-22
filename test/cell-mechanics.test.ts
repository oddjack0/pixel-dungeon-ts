/**
 * Stage 0 (exact copy) — cell mechanics: chasms, doors, high grass, signs,
 * locked chests. Every expectation cites the vanilla source it ports.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { Terrain } from '../src/core/grid.js';
import { Level } from '../src/dungeon/level.js';
import { RNG } from '../src/core/rng.js';
import type { ActionContext, MobActor } from '../src/engine/seams.js';
import {
  createStarterHero,
  addToInventory,
  type ContentHero,
} from '../src/content/hero.js';
import {
  moveHero,
  heroFall,
  mobFall,
  doorEnter,
  doorLeave,
  trampleHighGrass,
  pickupAt,
  pickupDewdrop,
  openLockedChest,
  noteSignCells,
  readSign,
  waitTurn,
  resetChasmState,
} from '../src/content/actions.js';
import { buildMob, type ContentMob } from '../src/content/mobs.js';
import { resolveItemSpawns, resolveItemTag } from '../src/content/spawns.js';

/** Deterministic RNG: int/intRange/float consume from the queues in order. */
function scriptedRng(ints: number[] = []): RNG {
  const rng = new RNG(1);
  let ii = 0;
  rng.int = (_min: number, _max: number) => ints[ii++] ?? 0;
  rng.float = (min: number, _max: number) => min;
  rng.intRange = (_min: number, _max: number) => ints[ii++] ?? 0;
  rng.normalIntRange = (min: number, _max: number) => min;
  rng.pick = <T>(arr: readonly T[]): T => arr[0]!;
  return rng;
}

function makeLevel(w = 12, h = 12, depth = 1): Level {
  const lvl = new Level(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) lvl.set(x, y, Terrain.FLOOR);
  lvl.depth = depth;
  lvl.stairsUp = 5 * w + 5;
  return lvl;
}

interface Ctx {
  ctx: ActionContext;
  hero: ContentHero;
  logs: string[];
  mobs: ContentMob[];
}

function makeCtx(level: Level, rng: RNG): Ctx {
  const hero = createStarterHero(5 * level.w + 5, level.w);
  const logs: string[] = [];
  const mobs: ContentMob[] = [];
  const ctx: ActionContext = {
    rng,
    level,
    hero,
    mobs: mobs as unknown as MobActor[],
    log: (m: string) => logs.push(m),
    killMob: (m: MobActor) => {
      const i = mobs.indexOf(m as ContentMob);
      if (i >= 0) mobs.splice(i, 1);
    },
    removeMob: (m: MobActor) => {
      const i = mobs.indexOf(m as ContentMob);
      if (i >= 0) mobs.splice(i, 1);
    },
    addMob: (m: MobActor, _delay?: number) => {
      mobs.push(m as ContentMob);
    },
    syncMobs: () => {},
  };
  return { ctx, hero, logs, mobs };
}

beforeEach(() => {
  resetChasmState();
});

// --- chasms (Chasm.java) ---

describe('chasm', () => {
  test('first step toward a chasm warns and does not move (free interrupt)', () => {
    // Hero.getCloser: Chasm.heroJump + interrupt() — no time passes while
    // the vanilla modal is open (Chasm.java:30-54, Hero.java:919-925).
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    const hx = c.hero.x;
    const hy = c.hero.y;
    level.set(hx + 1, hy, Terrain.CHASM);
    const cost = moveHero(c.ctx, c.hero, 1, 0);
    expect(cost).toBe(0);
    expect(c.hero.pos).toBe(hy * level.w + hx);
    expect(
      c.logs.some((l) =>
        l.includes('Do you really want to jump into the chasm?'),
      ),
    ).toBe(true);
  });

  test('repeating the step confirms the jump: cripple 10 + HT/3..HT/2 damage', () => {
    // Chasm.heroLand: Buff.prolong(hero, Cripple.class, DURATION=10) then
    // damage Random.IntRange(HT/3, HT/2), Java int division, inclusive
    // (Chasm.java:74-87). Starter HT=20 -> [6,10].
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng([8]));
    const hx = c.hero.x;
    const hy = c.hero.y;
    level.set(hx + 1, hy, Terrain.CHASM);
    moveHero(c.ctx, c.hero, 1, 0); // warn
    const cost = moveHero(c.ctx, c.hero, 1, 0); // confirm -> fall
    expect(cost).toBe(1);
    expect(c.hero.pos).toBe(hy * level.w + hx); // never steps in
    expect(c.hero.buffs.cripple?.left).toBe(10); // Cripple.DURATION
    expect(c.hero.hp).toBe(20 - 8);
    expect(c.logs.some((l) => l.includes('fall into the chasm'))).toBe(true);
  });

  test('a different step disarms the confirmation', () => {
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng([8]));
    const hx = c.hero.x;
    const hy = c.hero.y;
    level.set(hx + 1, hy, Terrain.CHASM);
    moveHero(c.ctx, c.hero, 1, 0); // warn (armed toward +x)
    moveHero(c.ctx, c.hero, 0, 1); // step elsewhere: "No"
    expect(c.hero.pos).toBe((hy + 1) * level.w + hx);
    expect(c.hero.hp).toBe(20); // no fall
    expect(c.hero.buffs.cripple).toBeUndefined();
  });

  test('flying hero steps over chasms freely (press skipped while flying)', () => {
    // Hero.move: if (!flying) press() — flying never falls (Hero.java:1229-1239).
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    const hx = c.hero.x;
    const hy = c.hero.y;
    c.hero.flying = true;
    level.set(hx + 1, hy, Terrain.CHASM);
    const cost = moveHero(c.ctx, c.hero, 1, 0);
    expect(c.hero.pos).toBe(hy * level.w + hx + 1);
    expect(c.hero.hp).toBe(20);
    expect(cost).toBe(1);
  });

  test('fatal fall logs the exact vanilla death line', () => {
    // Hero.Doom.onDeath: GLog.n("You fell to death...") (Chasm.java:80-86).
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng([10]));
    c.hero.hp = 5;
    heroFall(c.ctx, c.hero);
    expect(c.hero.isAlive()).toBe(false);
    expect(c.logs).toContain('You fell to death...');
  });

  test('mobFall destroys the mob outright (no exp/loot path)', () => {
    // Chasm.mobFall: mob.destroy() (Chasm.java:89-92).
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    const mob = buildMob('rat', 1, 5 * level.w + 6, level.w);
    c.mobs.push(mob);
    mobFall(c.ctx, mob);
    expect(mob.hp).toBe(0);
    expect(c.mobs).not.toContain(mob);
  });
});

// --- doors (Door.java, Char.java, Level.java) ---

describe('doors', () => {
  test('stepping onto a closed door opens it; leaving closes it', () => {
    // Door.enter (Door.java:14-21) on press; Door.leave (Door.java:23-29)
    // on Char.move away.
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    const hx = c.hero.x;
    const hy = c.hero.y;
    level.set(hx + 1, hy, Terrain.DOOR);
    moveHero(c.ctx, c.hero, 1, 0);
    expect(c.hero.pos).toBe(hy * level.w + hx + 1);
    expect(level.get(hx + 1, hy)).toBe(Terrain.OPEN_DOOR);
    moveHero(c.ctx, c.hero, -1, 0);
    expect(level.get(hx + 1, hy)).toBe(Terrain.DOOR);
  });

  test('a door with a heap on it stays open when left (Door.leave)', () => {
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    const hx = c.hero.x;
    const hy = c.hero.y;
    const doorPos = hy * level.w + hx + 1;
    level.set(hx + 1, hy, Terrain.DOOR);
    level.items.push({ pos: doorPos, itemId: 'ration', sprite: 'ration' });
    moveHero(c.ctx, c.hero, 1, 0);
    expect(level.get(hx + 1, hy)).toBe(Terrain.OPEN_DOOR);
    moveHero(c.ctx, c.hero, -1, 0);
    expect(level.get(hx + 1, hy)).toBe(Terrain.OPEN_DOOR);
  });

  test('doorEnter/doorLeave helpers are exact', () => {
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    doorEnter(c.ctx, 3, 3);
    expect(level.get(3, 3)).toBe(Terrain.OPEN_DOOR);
    doorLeave(c.ctx, 3, 3);
    expect(level.get(3, 3)).toBe(Terrain.DOOR);
  });

  test('a flying hero still opens a door on entry (Char.move flying branch)', () => {
    // Char.java:488-490: press() is skipped while flying, but the flying
    // door-enter in Char.move still fires.
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    const hx = c.hero.x;
    const hy = c.hero.y;
    c.hero.flying = true;
    level.set(hx + 1, hy, Terrain.DOOR);
    moveHero(c.ctx, c.hero, 1, 0);
    expect(c.hero.pos).toBe(hy * level.w + hx + 1);
    expect(level.get(hx + 1, hy)).toBe(Terrain.OPEN_DOOR);
  });
});

// --- high grass (HighGrass.java) ---

describe('high grass', () => {
  test('trampling flattens HIGH_GRASS to GRASS', () => {
    // HighGrass.trample: Level.set(pos, Terrain.GRASS) (HighGrass.java:35).
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng([17, 1, 5, 1])); // no drops
    trampleHighGrass(c.ctx, c.hero, 4, 4);
    expect(level.get(4, 4)).toBe(Terrain.GRASS);
    expect(level.items).toHaveLength(0);
  });

  test('seed drops when Int(18) <= Int(herbalism+1); dew when Int(6) <= Int(herbalism+1)', () => {
    // HighGrass.java:47-54; no RingOfHerbalism in the port -> level 0, so
    // seed needs Int(18)==0 and dew needs Int(6)==0.
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng([0, 0, 0, 0]));
    trampleHighGrass(c.ctx, c.hero, 4, 4);
    const ids = level.items.map((it) => it.itemId).sort();
    expect(ids).toEqual(['dewdrop', 'seed']);
  });

  test('no drops on unlucky rolls', () => {
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng([17, 1, 5, 1]));
    trampleHighGrass(c.ctx, c.hero, 4, 4);
    expect(level.items).toHaveLength(0);
  });

  test('stepping onto high grass tramples it via moveHero', () => {
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng([17, 1, 5, 1]));
    const hx = c.hero.x;
    const hy = c.hero.y;
    level.set(hx + 1, hy, Terrain.HIGH_GRASS);
    moveHero(c.ctx, c.hero, 1, 0);
    expect(level.get(hx + 1, hy)).toBe(Terrain.GRASS);
  });
});

// --- dewdrops (Dewdrop.java) ---

describe('dewdrop pickup', () => {
  test('heals 1 + (depth-1)/5, consumed on pickup', () => {
    // Dewdrop.doPickUp (Dewdrop.java:41-64): value = 1 + (depth-1)/5, Java
    // int division; effect = min(HT-HP, value*qty); never enters inventory.
    const level = makeLevel(12, 12, 1);
    const c = makeCtx(level, scriptedRng());
    c.hero.hp = 10;
    level.items.push({
      pos: c.hero.pos,
      itemId: 'dewdrop',
      sprite: 'dewdrop',
    });
    const cost = pickupAt(c.ctx, c.hero);
    expect(cost).toBe(1);
    expect(c.hero.hp).toBe(11);
    expect(level.items).toHaveLength(0);
    expect(c.hero.inventory.some((s) => s.itemId === 'dewdrop')).toBe(false);
    expect(c.logs.some((l) => l.includes('+1HP'))).toBe(true);
  });

  test('deeper depths heal more: depth 6 -> value 2', () => {
    const level = makeLevel(12, 12, 6);
    const c = makeCtx(level, scriptedRng());
    c.hero.hp = 10;
    pickupDewdrop(c.ctx, c.hero, 1);
    expect(c.hero.hp).toBe(12);
  });

  test('at full HP the drop is consumed for no healing (vanilla)', () => {
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    c.hero.hp = 20;
    level.items.push({ pos: c.hero.pos, itemId: 'dewdrop', sprite: 'dewdrop' });
    pickupDewdrop(c.ctx, c.hero, 1);
    expect(c.hero.hp).toBe(20);
  });
});

// --- signs (Sign.java) ---

describe('signs', () => {
  test('wait on a sign cell reads the depth tip for free', () => {
    // Sign.read: TIPS[depth-1]; vanilla trigger is a failed Move on SIGN
    // costing no time (Hero.actMove, Hero.java:485-498; Sign.java:84-88).
    const level = makeLevel(12, 12, 3);
    const c = makeCtx(level, scriptedRng());
    noteSignCells(level, [c.hero.pos]);
    const cost = waitTurn(c.ctx, c.hero);
    expect(cost).toBe(0);
    expect(c.logs.length).toBe(1);
    expect(typeof c.logs[0]).toBe('string');
  });

  test('depth 1 reads the first tip; depth 2 the second', () => {
    const l1 = makeLevel(12, 12, 1);
    const c1 = makeCtx(l1, scriptedRng());
    noteSignCells(l1, [c1.hero.pos]);
    readSign(c1.ctx, c1.hero);
    const l2 = makeLevel(12, 12, 2);
    const c2 = makeCtx(l2, scriptedRng());
    noteSignCells(l2, [c2.hero.pos]);
    readSign(c2.ctx, c2.hero);
    expect(c1.logs[0]).not.toBe(c2.logs[0]);
  });

  test('past the tip list the sign burns (Sign.read burn branch)', () => {
    // Sign.java:89-101: destroyed -> EMBERS, TXT_BURN message.
    const level = makeLevel(12, 12, 99);
    const c = makeCtx(level, scriptedRng());
    noteSignCells(level, [c.hero.pos]);
    const cost = readSign(c.ctx, c.hero);
    expect(cost).toBe(0);
    expect(level.get(c.hero.x, c.hero.y)).toBe(Terrain.EMBERS);
    expect(c.logs.some((l) => l.includes('greenish flames'))).toBe(true);
    // Burned away: a second wait is a plain wait.
    expect(waitTurn(c.ctx, c.hero)).toBe(1);
  });

  test('wait off a sign is a plain 1-turn wait', () => {
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    noteSignCells(level, [1234]);
    expect(waitTurn(c.ctx, c.hero)).toBe(1);
    expect(c.logs).toHaveLength(0);
  });
});

// --- locked chests (Hero.actOpenChest, Hero.java:615-648) ---

describe('locked chests', () => {
  test("golden-key tag resolves to the golden key (opens chests, not doors)", () => {
    expect(resolveItemTag(scriptedRng(), 1, 'golden-key')).toBe('golden_key');
  });

  test('resolveItemSpawns preserves LOCKED_CHEST/CRYSTAL_CHEST locked state', () => {
    const level = makeLevel();
    const placed = resolveItemSpawns(scriptedRng(), 1, [
      { pos: 10, heap: 'LOCKED_CHEST', tag: 'prize-weapon' },
      { pos: 11, heap: 'CRYSTAL_CHEST', tag: 'prize-armor' },
      { pos: 12, heap: 'HEAP', tag: 'prize-food' },
    ]);
    expect(placed[0]!.lockedChest).toBe(true);
    expect(placed[1]!.lockedChest).toBe(true);
    expect(placed[2]!.lockedChest).toBeUndefined();
    void level;
  });

  test('without a golden key: exact warning, no time spent, chest stays', () => {
    // TXT_LOCKED_CHEST (Hero.java:124); ready(), no spend (Hero.java:631-633).
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    const item = {
      pos: c.hero.pos,
      itemId: 'scroll',
      sprite: 'scroll',
      lockedChest: true,
    };
    level.items.push(item);
    const cost = openLockedChest(c.ctx, c.hero, item);
    expect(cost).toBe(0);
    expect(c.logs).toContain("This chest is locked and you don't have matching key");
    expect(level.items).toContain(item);
  });

  test('with a golden key: 1 turn, key consumed, loot taken', () => {
    // spend(Key.TIME_TO_UNLOCK); theKey.detach; heap.open (Hero.java:636-648,
    // Hero.java:1277-1288).
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    addToInventory(c.hero, 'golden_key', 1);
    const item = {
      pos: c.hero.pos,
      itemId: 'scroll',
      sprite: 'scroll',
      lockedChest: true,
    };
    level.items.push(item);
    const cost = openLockedChest(c.ctx, c.hero, item);
    expect(cost).toBe(1);
    expect(c.hero.inventory.some((s) => s.itemId === 'golden_key')).toBe(false);
    expect(level.items).not.toContain(item);
    expect(c.hero.inventory.some((s) => s.itemId === 'scroll')).toBe(true);
  });

  test('an iron key does not open a locked chest', () => {
    const level = makeLevel();
    const c = makeCtx(level, scriptedRng());
    addToInventory(c.hero, 'iron_key', 1);
    const item = {
      pos: c.hero.pos,
      itemId: 'scroll',
      sprite: 'scroll',
      lockedChest: true,
    };
    level.items.push(item);
    const cost = openLockedChest(c.ctx, c.hero, item);
    expect(cost).toBe(0);
    expect(level.items).toContain(item);
    expect(c.hero.inventory.some((s) => s.itemId === 'iron_key')).toBe(true);
  });
});
