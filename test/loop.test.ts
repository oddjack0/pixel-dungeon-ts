import { beforeEach, describe, expect, test } from 'bun:test';
import { Game } from '../src/engine/loop';
import { stubLevelGen } from '../src/dungeon/level';
import { stubMechanics } from '../src/engine/stubs';
import { clearSave, hasSave, loadGame, saveGame } from '../src/engine/save';
import type { HeroIntent } from '../src/engine/seams';

/** In-memory localStorage shim (bun has no DOM storage). */
function installStorage(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>)['localStorage'] = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

const deps = { gen: stubLevelGen, mechanics: stubMechanics };

describe('Game loop', () => {
  test('boots: hero at entrance, FOV computed, scheduler primed', () => {
    const g = new Game(1234, deps);
    expect(g.hero.x).toBe(2);
    expect(g.hero.y).toBe(2);
    expect(g.level.visible[g.level.idx(2, 2)]).toBe(1);
    expect(g.scheduler.count).toBe(1);
    expect(g.turnCount).toBe(0);
  });

  test('pump waits for hero input, then acts', () => {
    const g = new Game(1234, deps);
    expect(g.pump()).toBe('waiting');
    g.queueIntent({ kind: 'move', dx: 1, dy: 0 });
    expect(g.pump()).toBe('acted');
    expect(g.hero.x).toBe(3);
    expect(g.hero.y).toBe(2);
    expect(g.turnCount).toBe(1);
  });

  test('bumping a wall does not move the hero', () => {
    const g = new Game(1234, deps);
    g.queueIntent({ kind: 'move', dx: -1, dy: 0 }); // (1,2): floor
    g.pump();
    expect(g.hero.x).toBe(1);
    g.queueIntent({ kind: 'move', dx: -1, dy: 0 }); // (0,2): wall
    g.pump();
    expect(g.hero.x).toBe(1);
    expect(g.turnCount).toBe(2);
  });

  test('tap-to-move path is consumed one step per hero turn', () => {
    const g = new Game(1234, deps);
    g.setPath([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ]);
    g.pump();
    expect(g.hero.x).toBe(3);
    g.pump();
    expect(g.hero.x).toBe(4);
    expect(g.pathLength).toBe(1);
  });

  test('manual input cancels the path', () => {
    const g = new Game(1234, deps);
    g.setPath([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);
    g.queueIntent({ kind: 'wait' });
    expect(g.pathLength).toBe(0);
    g.pump();
    expect(g.hero.x).toBe(2); // waited, did not move
  });

  test('pickup removes a floor item and logs', () => {
    const g = new Game(1234, deps);
    g.level.items.push({ pos: g.level.idx(2, 2), itemId: 'potion_red', sprite: 'potion_red' });
    g.queueIntent({ kind: 'pickup' } satisfies HeroIntent);
    g.pump();
    expect(g.level.items).toHaveLength(0);
    expect(g.log.some((l) => l.includes('potion_red'))).toBe(true);
  });

  test('descend intent on stairs generates the next depth', () => {
    const g = new Game(1234, deps);
    // Teleport hero onto the down stairs for the test.
    const down = g.level.stairsDown;
    g.hero.x = down % g.level.w;
    g.hero.y = Math.floor(down / g.level.w);
    g.queueIntent({ kind: 'descend' });
    g.pump();
    expect(g.level.depth).toBe(2);
    expect(g.hero.x).toBe(2);
    expect(g.hero.y).toBe(2);
  });

  test('descend intent away from stairs is refused', () => {
    const g = new Game(1234, deps);
    g.queueIntent({ kind: 'descend' });
    g.pump();
    expect(g.level.depth).toBe(1);
    expect(g.log.some((l) => l.includes('no stairs'))).toBe(true);
  });

  test('log is capped', () => {
    const g = new Game(1, { ...deps, logCap: 5 });
    for (let i = 0; i < 20; i++) g.logMsg(`msg ${i}`);
    expect(g.log).toHaveLength(5);
    expect(g.log[4]).toBe('msg 19');
  });
});

describe('save/load', () => {
  beforeEach(() => {
    installStorage();
    clearSave();
  });

  test('hasSave reflects storage', () => {
    expect(hasSave()).toBe(false);
    const g = new Game(999, deps);
    saveGame(g, stubMechanics);
    expect(hasSave()).toBe(true);
  });

  test('round-trip preserves run state exactly', () => {
    const g = new Game(4242, deps);
    g.queueIntent({ kind: 'move', dx: 1, dy: 0 });
    g.pump();
    g.queueIntent({ kind: 'move', dx: 1, dy: 0 });
    g.pump();
    g.queueIntent({ kind: 'wait' });
    g.pump();
    g.level.items.push({ pos: g.level.idx(4, 2), itemId: 'dart', sprite: 'dart' });

    saveGame(g, stubMechanics);
    const expectedNext = g.rng.next(); // first draw after the saved state

    const g2 = loadGame(stubMechanics);
    expect(g2).not.toBeNull();

    expect(g2!.seed).toBe(4242);
    expect(g2!.hero.x).toBe(4);
    expect(g2!.hero.y).toBe(2);
    expect(g2!.hero.hp).toBe(g.hero.hp);
    expect(g2!.turnCount).toBe(3);
    expect(g2!.log).toEqual(g.log);
    expect(g2!.level.depth).toBe(g.level.depth);
    expect(g2!.level.tiles).toEqual(g.level.tiles);
    expect(g2!.level.explored).toEqual(g.level.explored);
    expect(g2!.level.items).toEqual(g.level.items);
    expect(g2!.scheduler.now).toBe(g.scheduler.now);
    // RNG stream continues identically after restore.
    expect(g2!.rng.next()).toBe(expectedNext);
  });

  test('loadGame returns null for missing/corrupt saves', () => {
    expect(loadGame(stubMechanics)).toBeNull();
    (globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: () => 'not-json{{{',
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadGame(stubMechanics)).toBeNull();
  });
});
