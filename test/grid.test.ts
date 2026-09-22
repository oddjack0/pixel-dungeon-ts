import { describe, expect, test } from 'bun:test';
import {
  Feeling,
  Grid,
  Region,
  Terrain,
  TRAP_TYPES,
  isHiddenTrap,
  isTrap,
  regionForDepth,
  regionLabel,
  revealTrapTile,
  trapName,
} from '../src/core/grid';

describe('Terrain enum (canonical ids — never renumber)', () => {
  test('core ids', () => {
    expect(Terrain.WALL).toBe(0);
    expect(Terrain.FLOOR).toBe(1);
    expect(Terrain.DOOR).toBe(2);
    expect(Terrain.DOOR_LOCKED).toBe(3);
    expect(Terrain.DOOR_SECRET).toBe(4);
    expect(Terrain.EXIT_LOCKED).toBe(5);
    expect(Terrain.ENTRANCE).toBe(6);
    expect(Terrain.EXIT).toBe(7);
    expect(Terrain.CHASM).toBe(8);
    expect(Terrain.WATER).toBe(9);
    expect(Terrain.HIGH_GRASS).toBe(39);
  });

  test('trap ids are even/odd hidden pairs', () => {
    expect(Terrain.TRAP_TOXIC).toBe(20);
    expect(Terrain.TRAP_TOXIC_HIDDEN).toBe(21);
    expect(Terrain.TRAP_SUMMONING).toBe(34);
    expect(Terrain.TRAP_SUMMONING_HIDDEN).toBe(35);
    expect(Terrain.TRAP_INACTIVE).toBe(36);
    expect(TRAP_TYPES).toHaveLength(8);
  });

  test('trap helpers', () => {
    expect(isHiddenTrap(Terrain.TRAP_FIRE_HIDDEN)).toBe(true);
    expect(isHiddenTrap(Terrain.TRAP_FIRE)).toBe(false);
    expect(isTrap(Terrain.TRAP_POISON)).toBe(true);
    expect(isTrap(Terrain.TRAP_POISON_HIDDEN)).toBe(true);
    expect(isTrap(Terrain.TRAP_INACTIVE)).toBe(true);
    expect(isTrap(Terrain.FLOOR)).toBe(false);
    expect(revealTrapTile(Terrain.TRAP_ALARM_HIDDEN)).toBe(Terrain.TRAP_ALARM);
    expect(revealTrapTile(Terrain.TRAP_ALARM)).toBe(Terrain.TRAP_ALARM);
    expect(trapName(Terrain.TRAP_LIGHTNING_HIDDEN)).toBe('a lightning trap');
  });

  test('regions', () => {
    expect(regionForDepth(1)).toBe(Region.SEWERS);
    expect(regionForDepth(5)).toBe(Region.SEWERS);
    expect(regionForDepth(6)).toBe(Region.PRISON);
    expect(regionForDepth(26)).toBe(Region.HALLS);
    expect(regionLabel(Region.SEWERS)).toBe('Sewers');
    expect(Feeling.NONE as string).toBe('none');
  });
});

describe('Grid', () => {
  test('indexing and bounds', () => {
    const g = new Grid(10, 8);
    expect(g.size).toBe(80);
    expect(g.idx(3, 2)).toBe(23);
    expect(g.xy(23)).toEqual({ x: 3, y: 2 });
    expect(g.inBounds(9, 7)).toBe(true);
    expect(g.inBounds(10, 7)).toBe(false);
    expect(g.inBounds(-1, 0)).toBe(false);
  });

  test('neighborhoods', () => {
    const g = new Grid(5, 5);
    expect(g.neighbors4(0, 0)).toHaveLength(2);
    expect(g.neighbors4(2, 2)).toHaveLength(4);
    expect(g.neighbors8(2, 2)).toHaveLength(8);
    expect(g.neighbors8(0, 0)).toHaveLength(3);
    expect(Grid.chebyshev(0, 0, 3, 4)).toBe(4);
  });
});
