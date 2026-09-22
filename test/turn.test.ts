import { describe, expect, test } from 'bun:test';
import { Actor, Scheduler, TICK } from '../src/core/turn';

class Dummy extends Actor {
  constructor(
    private speed: number,
    public label: string,
  ) {
    super();
  }
  getSpeed(): number {
    return this.speed;
  }
  act(): number {
    return 1;
  }
}

describe('Scheduler', () => {
  test('TICK is 1', () => {
    expect(TICK).toBe(1);
    expect(Actor.TICK).toBe(1);
  });

  test('next() returns earliest actor and advances the clock', () => {
    const s = new Scheduler();
    const a = new Dummy(1, 'a');
    const b = new Dummy(1, 'b');
    a.time = 5;
    b.time = 2;
    s.add(a);
    s.add(b);
    expect(s.next()).toBe(b);
    expect(s.now).toBe(2);
    expect(s.next()).toBe(a);
    expect(s.now).toBe(5);
  });

  test('spend() schedules next turn at now + cost/speed', () => {
    const s = new Scheduler();
    const slow = new Dummy(1, 'slow');
    const fast = new Dummy(2, 'fast');
    s.add(slow);
    s.add(fast);
    s.next(); // t=0, slow (tie -> first-insertion order wins the first tie)
    s.spend(slow, 1); // next at 1.0
    const n = s.next(); // t=0, fast
    expect(n).toBe(fast);
    s.spend(fast, 1); // next at 0.5
    expect(s.next()).toBe(fast); // fast acts again before slow
    expect(s.now).toBe(0.5);
  });

  test('faster actor acts proportionally more often', () => {
    const s = new Scheduler();
    const slow = new Dummy(1, 'slow');
    const fast = new Dummy(2, 'fast');
    s.add(slow);
    s.add(fast);
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = s.next() as Dummy;
      order.push(a.label);
      s.spend(a, 1);
    }
    expect(order.filter((l) => l === 'fast')).toHaveLength(4);
    expect(order.filter((l) => l === 'slow')).toHaveLength(2);
  });

  test('remove() drops the actor', () => {
    const s = new Scheduler();
    const a = new Dummy(1, 'a');
    const b = new Dummy(1, 'b');
    s.add(a);
    s.add(b);
    s.remove(a);
    expect(s.count).toBe(1);
    expect(s.next()).toBe(b);
  });

  test('add() is idempotent', () => {
    const s = new Scheduler();
    const a = new Dummy(1, 'a');
    s.add(a);
    s.add(a);
    expect(s.count).toBe(1);
  });

  test('next() on empty scheduler throws', () => {
    const s = new Scheduler();
    expect(() => s.next()).toThrow();
  });

  test('clear() empties and resets the clock', () => {
    const s = new Scheduler();
    const a = new Dummy(1, 'a');
    s.add(a);
    s.next();
    s.clear();
    expect(s.count).toBe(0);
    expect(s.now).toBe(0);
    expect(s.peek()).toBeUndefined();
  });
});
