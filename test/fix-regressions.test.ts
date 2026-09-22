/**
 * Regression tests for the FIX-REPORT items (2026-09-19 code review):
 * search, generation determinism, descend ordering, bump-attack, death on
 * mob turn, Goo jump landing, transition ticks, drop cost, Goo stats, and
 * single-source consolidation.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain } from '../src/core/grid.js';
import { Scheduler } from '../src/core/turn.js';
import { Level } from '../src/dungeon/level.js';
import { sewersLevelGen } from '../src/dungeon/generator.js';
import { stubLevelGen } from '../src/dungeon/level.js';
import { Game } from '../src/engine/loop.js';
import { stubMechanics } from '../src/engine/stubs.js';
import type { ActionContext, MobActor } from '../src/engine/seams.js';
import { contentMechanics } from '../src/content/hooks.js';
import { contentLevelGen } from '../src/content/spawns.js';
import { buildMob, type ContentMob } from '../src/content/mobs.js';
import {
  createStarterHero,
  type ContentHero,
} from '../src/content/hero.js';
import { dropSlot, TIME_TO_SEARCH } from '../src/content/actions.js';
import { getItem } from '../src/content/items.js';
import { GooMob, GOO_DEF } from '../src/content/goo-boss.js';
import {
  DART,
  SHORT_SWORD,
  CLOTH_ARMOR,
} from '../src/mechanics/hero.js';
import { GOO_RESISTANCES } from '../src/mechanics/goo.js';
import { expForKill, MOB_EXP } from '../src/mechanics/exp.js';

const stubDeps = { gen: stubLevelGen, mechanics: stubMechanics };
const contentStubDeps = { gen: stubLevelGen, mechanics: contentMechanics };

/** Minimal ActionContext for direct mechanics calls. */
function makeCtx(level: Level, hero: ContentHero, seed = 99): ActionContext {
  const logs: string[] = [];
  const mobs: ContentMob[] = [];
  return {
    rng: new RNG(seed),
    level,
    hero,
    mobs: mobs as unknown as MobActor[],
    log: (m: string) => logs.push(m),
    killMob: () => {},
    addMob: () => {},
    syncMobs: () => {},
  };
}

function openLevel(w = 12, h = 12): Level {
  const lvl = new Level(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) lvl.set(x, y, Terrain.FLOOR);
  lvl.stairsUp = 2 * w + 2;
  lvl.stairsDown = (h - 3) * w + (w - 3);
  return lvl;
}

// --- 1. search ---

describe('search (Hero.search, Hero.java:1295)', () => {
  test('intentional search reveals an adjacent secret door, costs 2 turns', () => {
    const g = new Game(42, contentStubDeps);
    const hero = g.hero as unknown as ContentHero;
    // Hero starts at (2,2); plant a secret door east of them.
    g.level.set(3, 2, Terrain.DOOR_SECRET);
    g.level.visible[g.level.idx(3, 2)] = 1;
    const nowBefore = g.scheduler.now;
    g.queueIntent({ kind: 'search' });
    expect(g.pump()).toBe('acted');
    expect(g.level.get(3, 2)).toBe(Terrain.DOOR);
    expect(g.scheduler.now).toBe(nowBefore); // clock advanced on pop...
    expect(hero.time - g.scheduler.now).toBe(TIME_TO_SEARCH);
    expect(TIME_TO_SEARCH).toBe(2); // Hero.java:134
  });

  test('search does not reveal doors beyond radius 1', () => {
    const g = new Game(42, contentStubDeps);
    g.level.set(4, 2, Terrain.DOOR_SECRET); // two cells east
    g.level.visible[g.level.idx(4, 2)] = 1;
    g.queueIntent({ kind: 'search' });
    g.pump();
    expect(g.level.get(4, 2)).toBe(Terrain.DOOR_SECRET);
  });

  test('passive search after movement uses the awareness roll', () => {
    const g = new Game(42, contentStubDeps);
    const hero = g.hero as unknown as ContentHero;
    hero.awareness = 1.0; // force the roll to succeed
    g.level.set(3, 2, Terrain.DOOR_SECRET);
    g.level.visible[g.level.idx(3, 2)] = 1;
    // Move south; (3,2) is diagonally adjacent to (2,3).
    g.queueIntent({ kind: 'move', dx: 0, dy: 1 });
    g.pump();
    expect(hero.x).toBe(2);
    expect(hero.y).toBe(3);
    expect(g.level.get(3, 2)).toBe(Terrain.DOOR);
  });
});

// --- 2. determinism ---

describe('generation determinism', () => {
  test('three same-seed runs generate byte-identical depth-1 levels', () => {
    const mk = () =>
      new Game(20260919, { gen: sewersLevelGen, mechanics: stubMechanics });
    const [a, b, c] = [mk(), mk(), mk()];
    for (const [x, y] of [
      [a, b],
      [b, c],
    ] as const) {
      expect([...x.level.tiles]).toEqual([...y.level.tiles]);
      expect(x.level.stairsUp).toBe(y.level.stairsUp);
      expect(x.level.stairsDown).toBe(y.level.stairsDown);
      expect(x.level.doors).toEqual(y.level.doors);
      expect(x.level.traps).toEqual(y.level.traps);
      expect(x.level.items).toEqual(y.level.items);
      expect(x.rng.serialize()).toBe(y.rng.serialize());
    }
  });

  test('a fresh run does not inherit specials rotation from a previous run', () => {
    // The first run mutates the module-level rotation; the second must still
    // match a run built in isolation (resetSpecials once per run).
    const mk = () =>
      new Game(555, { gen: sewersLevelGen, mechanics: stubMechanics });
    const first = mk();
    const tilesFirst = [...first.level.tiles];
    const second = mk();
    expect([...second.level.tiles]).toEqual(tilesFirst);
  });
});

// --- 3. descend ordering ---

describe('descend ordering (Actor.init, vanilla)', () => {
  test('hero acts first on the new floor', () => {
    const g = new Game(777, {
      gen: contentLevelGen,
      mechanics: contentMechanics,
    });
    const down = g.level.stairsDown;
    g.hero.x = down % g.level.w;
    g.hero.y = Math.floor(down / g.level.w);
    g.queueIntent({ kind: 'descend' });
    g.pump();
    expect(g.level.depth).toBe(2);
    expect(g.mobs.length).toBeGreaterThan(0); // ordering is meaningful
    expect(g.scheduler.peek()).toBe(g.hero);
  });
});

// --- 4. bump-attack ---

describe('bump-attack (Hero.handle)', () => {
  test('keyboard move into a mob attacks instead of stacking', () => {
    const g = new Game(42, contentStubDeps);
    const hero = g.hero as unknown as ContentHero;
    const rat = buildMob('rat', 7, 2 * g.level.w + 3, g.level.w); // (3,2)
    g.mobs.push(rat);
    g.queueIntent({ kind: 'move', dx: 1, dy: 0 });
    expect(g.pump()).toBe('acted');
    // Hero did not move onto the mob's cell...
    expect(hero.x).toBe(2);
    expect(hero.y).toBe(2);
    // ...and attacked it (hit or miss always logs; a hit wakes the rat).
    expect(g.log.some((l) => /You (hit|miss)/.test(l))).toBe(true);
    expect(rat.state).not.toBe('sleeping');
  });
});

// --- 5. death on mob turn ---

describe('death by mob ends the run immediately', () => {
  test('mob kill sets gameOver and pump returns over', () => {
    const g = new Game(42, stubDeps);
    const killer: MobActor = {
      id: 4242,
      x: 3,
      y: 2,
      hp: 10,
      ht: 10,
      name: 'killer',
      sprite: 'mob_rat',
      hostile: true,
      time: 0,
      getSpeed: () => 1,
      isAlive: () => true,
      act: () => {
        g.hero.hp = 0;
        return 1;
      },
    };
    g.mobs.push(killer);
    g.scheduler.add(killer);
    g.queueIntent({ kind: 'wait' });
    expect(g.pump()).toBe('acted'); // hero waits
    expect(g.pump()).toBe('over'); // mob kills hero -> death screen now
    expect(g.gameOver).toBe(true);
    expect(g.log.some((l) => l.includes('You died'))).toBe(true);
  });
});

// --- 6. Goo jump landing ---

describe('Goo jump landing (Goo.java:117)', () => {
  test('lands on the cell BEFORE the hero along the trace', () => {
    const lvl = openLevel();
    const hero = createStarterHero(7 * lvl.w + 5, lvl.w); // (5,7)
    const goo = new GooMob(1, 5 * lvl.w + 5, lvl.w); // (5,5), dist 2
    goo.pumpedUp = true;
    const ctx = makeCtx(lvl, hero);
    const before = goo.pos;
    goo.doAttack(ctx, hero);
    // Jump attack fired (pumped + dist 2 + clear path)...
    expect(goo.pos).not.toBe(before);
    // ...landing on (5,6): hero - sign(hero - goo), NOT beyond the hero.
    expect(goo.pos).toBe(6 * lvl.w + 5);
    expect(goo.pos).not.toBe(8 * lvl.w + 5);
  });

  test('invalid landing cell keeps Goo in place', () => {
    const lvl = openLevel();
    const hero = createStarterHero(7 * lvl.w + 5, lvl.w); // (5,7)
    const goo = new GooMob(1, 5 * lvl.w + 5, lvl.w); // (5,5)
    goo.pumpedUp = true;
    // Occupy the landing cell (5,6) with another mob: path is ballistically
    // clear (opacity only) but the landing cell is invalid.
    const blocker = buildMob('rat', 2, 6 * lvl.w + 5, lvl.w);
    const ctx = makeCtx(lvl, hero);
    (ctx.mobs as unknown as ContentMob[]).push(blocker);
    lvl.mobs.push({
      id: 2, x: 5, y: 6, hp: 8, ht: 8,
      name: 'rat', sprite: 'mob_rat', hostile: true,
    });
    goo.doAttack(ctx, hero);
    expect(goo.pos).toBe(5 * lvl.w + 5); // stayed put, still struck
  });
});

// --- 7. transition ticks ---

describe('depth transitions tick buffs and hunger/regen', () => {
  test('descend ticks the hunger clock', () => {
    const g = new Game(42, contentStubDeps);
    const hero = g.hero as unknown as ContentHero;
    hero.hungerClock = 9;
    hero.hungerLevel = 259; // one tick away from hungry (260)
    const down = g.level.stairsDown;
    g.hero.x = down % g.level.w;
    g.hero.y = Math.floor(down / g.level.w);
    g.queueIntent({ kind: 'descend' });
    g.pump();
    expect(g.level.depth).toBe(2);
    expect(hero.hungerLevel).toBe(269); // hunger ticked on the transition
  });

  test('descend ticks buffs before the transition', () => {
    const g = new Game(42, contentStubDeps);
    const hero = g.hero as unknown as ContentHero;
    hero.hp = 20;
    hero.buffs.poison = { kind: 'poison', left: 12 };
    const down = g.level.stairsDown;
    g.hero.x = down % g.level.w;
    g.hero.y = Math.floor(down / g.level.w);
    g.queueIntent({ kind: 'descend' });
    g.pump();
    expect(g.level.depth).toBe(2);
    expect(hero.hp).toBeLessThan(20); // poison ticked pre-transition
  });
});

// --- 8/9/11/12. stats & single-sourcing ---

describe('stat fixes and single sources of truth', () => {
  test('drop costs TIME_TO_DROP = 0.5 (Item.java:70)', () => {
    const lvl = openLevel();
    const hero = createStarterHero(2 * lvl.w + 2, lvl.w);
    const ctx = makeCtx(lvl, hero);
    expect(dropSlot(ctx, hero, 0)).toBe(0.5);
  });

  test('Goo maxLvl is the Mob default 30, single-sourced', () => {
    expect(GOO_DEF.maxLvl).toBe(30);
    expect(MOB_EXP.goo.maxLvl).toBe(30);
    expect(expForKill('goo', 30)).toBe(10);
    expect(expForKill('goo', 31)).toBe(0);
  });

  test('Goo resistances: ToxicGas/Death/PsionicBlast halve damage', () => {
    expect([...GOO_DEF.resistances].sort()).toEqual(
      [...GOO_RESISTANCES].sort(),
    );
    expect(GOO_RESISTANCES).toContain('toxic_gas');
    expect(GOO_RESISTANCES).toContain('death');
    expect(GOO_RESISTANCES).toContain('psionic_blast');
    expect(GOO_DEF.immunities).toEqual([]);
  });

  test('catalog is the single source for starting gear stats', () => {
    // src/content/items.ts is canonical (Java citations live there);
    // src/mechanics/hero.ts mirrors it for formula defaults.
    expect(getItem('shortsword').weapon).toEqual(SHORT_SWORD);
    expect(getItem('dart').weapon).toEqual(DART);
    expect(getItem('cloth_armor').armor).toEqual(CLOTH_ARMOR);
  });
});

// --- 10. scheduler tie-break policy ---

describe('scheduler tie-break policy', () => {
  class Dummy {
    time: number;
    constructor(
      time: number,
      public label: string,
    ) {
      this.time = time;
    }
    getSpeed(): number {
      return 1;
    }
  }

  test('sustained ties alternate in re-insertion order (round-robin)', () => {
    const s = new Scheduler();
    const a = new Dummy(0, 'a');
    const b = new Dummy(0, 'b');
    s.add(a);
    s.add(b);
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next = s.next() as Dummy;
      order.push(next.label);
      s.spend(next, 1);
    }
    // First-insertion wins the first tie; acting re-stamps, so they alternate.
    expect(order).toEqual(['a', 'b', 'a', 'b']);
  });
});
