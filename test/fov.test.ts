import { describe, expect, test } from 'bun:test';
import { Grid, Terrain } from '../src/core/grid';
import { computeFov } from '../src/core/fov';
import { Level } from '../src/dungeon/level';

function openLevel(w: number, h: number): Level {
  const lvl = new Level(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lvl.set(x, y, Terrain.FLOOR);
  return lvl;
}

describe('computeFov (shadowcast)', () => {
  test('open room: everything within radius visible', () => {
    const lvl = openLevel(11, 11);
    const out = new Uint8Array(lvl.size);
    computeFov(lvl, (x, y) => lvl.isOpaque(x, y), 5, 5, 8, out);
    for (let i = 0; i < lvl.size; i++) expect(out[i]).toBe(1);
  });

  test('viewer always sees own cell', () => {
    const lvl = openLevel(5, 5);
    const out = new Uint8Array(lvl.size);
    computeFov(lvl, (x, y) => lvl.isOpaque(x, y), 2, 2, 0, out);
    expect(out[lvl.idx(2, 2)]).toBe(1);
    expect(out[lvl.idx(0, 0)]).toBe(0);
  });

  test('wall blocks cells behind it but is itself visible', () => {
    const lvl = openLevel(11, 11);
    for (let y = 0; y < 11; y++) lvl.set(5, y, Terrain.WALL); // vertical wall
    const out = new Uint8Array(lvl.size);
    computeFov(lvl, (x, y) => lvl.isOpaque(x, y), 2, 5, 8, out);
    expect(out[lvl.idx(5, 5)]).toBe(1); // the wall face is visible
    expect(out[lvl.idx(8, 5)]).toBe(0); // behind the wall: hidden
    expect(out[lvl.idx(3, 5)]).toBe(1); // same side: visible
  });

  test('radius limits sight (Chebyshev)', () => {
    const lvl = openLevel(21, 21);
    const out = new Uint8Array(lvl.size);
    computeFov(lvl, (x, y) => lvl.isOpaque(x, y), 10, 10, 3, out);
    expect(out[lvl.idx(13, 10)]).toBe(1);
    expect(out[lvl.idx(14, 10)]).toBe(0);
    expect(out[lvl.idx(13, 13)]).toBe(1); // diagonal within chebyshev 3
  });

  test('corner peeking: diagonal gaps leak correctly around a pillar', () => {
    const lvl = openLevel(9, 9);
    lvl.set(4, 4, Terrain.WALL);
    const out = new Uint8Array(lvl.size);
    computeFov(lvl, (x, y) => lvl.isOpaque(x, y), 2, 4, 8, out);
    expect(out[lvl.idx(4, 4)]).toBe(1);
    expect(out[lvl.idx(6, 4)]).toBe(0); // directly behind the pillar
  });

  test('updateFov folds visible into explored', () => {
    const lvl = openLevel(9, 9);
    lvl.updateFov(4, 4, 8);
    expect(lvl.exploredCount()).toBe(81);
    // Move behind a wall: previously seen cells stay explored.
    for (let y = 0; y < 9; y++) lvl.set(4, y, Terrain.WALL);
    lvl.updateFov(1, 4, 8);
    expect(lvl.explored[lvl.idx(7, 4)]).toBe(1);
    expect(lvl.visible[lvl.idx(7, 4)]).toBe(0);
  });
});
