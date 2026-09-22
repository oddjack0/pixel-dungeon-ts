import { describe, expect, test } from 'bun:test';
import { Grid, Terrain } from '../src/core/grid';
import { findPath } from '../src/core/path';
import { Level } from '../src/dungeon/level';

function openLevel(w: number, h: number): Level {
  const lvl = new Level(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lvl.set(x, y, Terrain.FLOOR);
  return lvl;
}

const passable = (lvl: Level) => (x: number, y: number) => lvl.isPassable(x, y);

describe('findPath (A*)', () => {
  test('straight line on open ground', () => {
    const lvl = openLevel(10, 10);
    const path = findPath(lvl, passable(lvl), 1, 1, 4, 1);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3);
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 1 });
  });

  test('diagonal shortcut', () => {
    const lvl = openLevel(10, 10);
    const path = findPath(lvl, passable(lvl), 1, 1, 3, 3);
    expect(path!.length).toBe(2);
  });

  test('routes around a wall', () => {
    const lvl = openLevel(10, 10);
    for (let y = 0; y < 9; y++) lvl.set(5, y, Terrain.WALL);
    const path = findPath(lvl, passable(lvl), 2, 4, 8, 4);
    expect(path).not.toBeNull();
    // Must cross the wall column via the gap at y=9.
    expect(path!.some((p) => p.x === 5 && p.y === 9)).toBe(true);
    for (const p of path!) expect(lvl.get(p.x, p.y)).toBe(Terrain.FLOOR);
  });

  test('start == target returns empty path', () => {
    const lvl = openLevel(5, 5);
    expect(findPath(lvl, passable(lvl), 2, 2, 2, 2)).toEqual([]);
  });

  test('null when target is a wall', () => {
    const lvl = openLevel(5, 5);
    lvl.set(3, 3, Terrain.WALL);
    expect(findPath(lvl, passable(lvl), 1, 1, 3, 3)).toBeNull();
  });

  test('null when target unreachable (sealed room)', () => {
    const lvl = openLevel(7, 7);
    for (let x = 1; x <= 5; x++) {
      lvl.set(x, 1, Terrain.WALL);
      lvl.set(x, 5, Terrain.WALL);
    }
    for (let y = 1; y <= 5; y++) {
      lvl.set(1, y, Terrain.WALL);
      lvl.set(5, y, Terrain.WALL);
    }
    lvl.set(3, 3, Terrain.FLOOR);
    // Sealed 3x3 pocket around (3,3); start outside at (0,0).
    expect(findPath(lvl, passable(lvl), 0, 0, 3, 3)).toBeNull();
  });

  test('null when target out of bounds', () => {
    const lvl = openLevel(5, 5);
    expect(findPath(lvl, passable(lvl), 1, 1, 9, 9)).toBeNull();
  });

  test('hidden traps are walkable', () => {
    const lvl = openLevel(5, 5);
    lvl.set(2, 2, Terrain.TRAP_FIRE_HIDDEN);
    expect(lvl.isPassable(2, 2)).toBe(true);
    const path = findPath(lvl, passable(lvl), 0, 0, 4, 4);
    expect(path).not.toBeNull();
  });
});
