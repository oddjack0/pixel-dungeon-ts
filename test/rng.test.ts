import { describe, expect, test } from 'bun:test';
import { RNG, hashSeed } from '../src/core/rng';

describe('RNG', () => {
  test('same seed => same stream', () => {
    const a = new RNG(12345);
    const b = new RNG(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  test('different seeds => different streams', () => {
    const a = new RNG(1);
    const b = new RNG(2);
    let same = 0;
    for (let i = 0; i < 20; i++) if (a.next() === b.next()) same++;
    expect(same).toBeLessThan(20);
  });

  test('int(a,b) in [a,b)', () => {
    const r = new RNG(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 8);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(8);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  test('intRange(a,b) in [a,b] inclusive, hits both ends', () => {
    const r = new RNG(9);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.intRange(1, 3);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen.has(1)).toBe(true);
    expect(seen.has(3)).toBe(true);
  });

  test('float(a,b) in [a,b)', () => {
    const r = new RNG(11);
    for (let i = 0; i < 500; i++) {
      const v = r.float(2.5, 7.5);
      expect(v).toBeGreaterThanOrEqual(2.5);
      expect(v).toBeLessThan(7.5);
    }
  });

  test('normalIntRange(a,b) stays in [a,b] and clusters centrally', () => {
    const r = new RNG(13);
    const counts = new Array(11).fill(0);
    for (let i = 0; i < 4000; i++) {
      const v = r.normalIntRange(0, 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
      counts[v]++;
    }
    // Triangular: the middle must beat either extreme.
    expect(counts[5]).toBeGreaterThan(counts[0]);
    expect(counts[5]).toBeGreaterThan(counts[10]);
  });

  test('pick returns members of the array', () => {
    const r = new RNG(17);
    const arr = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) expect(arr).toContain(r.pick(arr));
  });

  test('serialize/restore continues the identical stream', () => {
    const r = new RNG(42);
    for (let i = 0; i < 50; i++) r.next();
    const state = r.serialize();
    const expected = [r.next(), r.next(), r.next()];
    const r2 = RNG.restore(42, state);
    expect([r2.next(), r2.next(), r2.next()]).toEqual(expected);
  });

  test('hashSeed is stable and distributes', () => {
    expect(hashSeed('dragon')).toBe(hashSeed('dragon'));
    expect(hashSeed('dragon')).not.toBe(hashSeed('Dragon'));
  });
});
