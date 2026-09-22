/**
 * Turn scheduler, mirroring Pixel Dungeon's Actor time model:
 * every turn-taker has a `time` (the clock value at which it may act next).
 * Acting costs time/speed, so faster actors act more often.
 * 1 turn = Actor.TICK (1.0) time units at speed 1.
 */

/** One full turn at speed 1. */
export const TICK = 1;

export interface TurnTaker {
  /** Clock value at which this actor may act next. */
  time: number;
  /** Acts per TICK; >1 means more frequent turns. */
  getSpeed(): number;
  /**
   * Char.spend time scale (Char.java:303-314): Slow x0.5, Speed x2.0.
   * Optional so plain TurnTakers default to 1.
   */
  getTimeScale?(): number;
}

/**
 * Base class for anything that takes turns (hero, mobs).
 * Player-driven actors are driven by input; the Game charges their turns
 * via Scheduler.spend(). AI actors override act() and return a time cost.
 */
export abstract class Actor implements TurnTaker {
  static readonly TICK = TICK;
  time = 0;

  getSpeed(): number {
    return 1;
  }

  /** Char.spend time scale (Char.java:303-314); 1 when no Slow/Speed buff. */
  getTimeScale(): number {
    return 1;
  }

  /** Perform one action; returns its time cost in turn units. */
  abstract act(): number;
}

/**
 * Time-ordered scheduler: a binary min-heap keyed by (time, re-insertion order).
 *
 * TIE-BREAK POLICY (recorded): every add() stamps the actor with a fresh,
 * monotonically increasing sequence number, so simultaneous times break by
 * RE-INSERTION order, not first-insertion order. spend() pops the actor
 * (next()) and re-adds it with a new stamp, so actors stuck in a sustained
 * tie alternate in re-add order (round-robin). The hero is registered first
 * on a fresh floor and therefore wins the first tie, then alternates. This
 * is equivalent to vanilla's HashSet iteration order in sustained ties
 * (also undefined there).
 */
export class Scheduler {
  private heap: TurnTaker[] = [];
  private seq = 0;
  private order = new Map<TurnTaker, number>();
  now = 0;

  get count(): number {
    return this.heap.length;
  }

  add(a: TurnTaker): void {
    if (this.order.has(a)) return;
    this.order.set(a, this.seq++);
    this.push(a);
  }

  remove(a: TurnTaker): void {
    if (!this.order.has(a)) return;
    this.order.delete(a);
    const i = this.heap.indexOf(a);
    if (i >= 0) {
      const last = this.heap.pop()!;
      if (i < this.heap.length) {
        this.heap[i] = last;
        this.bubbleDown(i);
        this.bubbleUp(i);
      }
    }
  }

  contains(a: TurnTaker): boolean {
    return this.order.has(a);
  }

  /** Remove all actors and reset the clock (used by save/load). */
  clear(): void {
    this.heap = [];
    this.order.clear();
    this.seq = 0;
    this.now = 0;
  }

  /** Earliest actor without advancing the clock (undefined when empty). */
  peek(): TurnTaker | undefined {
    return this.heap[0];
  }

  /** Returns the turn-taker whose turn is next, advancing the clock to it. */
  next(): TurnTaker {
    const m = this.pop();
    if (!m) throw new Error('Scheduler: no actors');
    this.order.delete(m);
    this.now = m.time;
    return m;
  }

  /**
   * Charge `taker` for acting; its next turn comes after
   * cost / (speed * timeScale) time units. The timeScale is vanilla
   * Char.spend (Char.java:303-314): Slow halves it (charged 2x), Speed
   * doubles it (charged half) -- separate from speed(), which callers
   * already fold into cost (e.g. vanilla spend(1 / speed())).
   */
  spend(taker: TurnTaker, cost: number): void {
    const timeScale = taker.getTimeScale?.() ?? 1;
    taker.time =
      this.now + cost / Math.max(0.01, taker.getSpeed()) / timeScale;
    this.add(taker);
  }

  // --- min-heap internals ---

  private less(a: TurnTaker, b: TurnTaker): boolean {
    if (a.time !== b.time) return a.time < b.time;
    return (this.order.get(a) ?? 0) < (this.order.get(b) ?? 0);
  }

  private push(a: TurnTaker): void {
    this.heap.push(a);
    this.bubbleUp(this.heap.length - 1);
  }

  private pop(): TurnTaker | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (top !== undefined && last !== undefined && this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(this.heap[i]!, this.heap[p]!)) break;
      [this.heap[i], this.heap[p]] = [this.heap[p]!, this.heap[i]!];
      i = p;
    }
  }

  private bubbleDown(i: number): void {
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < this.heap.length && this.less(this.heap[l]!, this.heap[m]!)) m = l;
      if (r < this.heap.length && this.less(this.heap[r]!, this.heap[m]!)) m = r;
      if (m === i) break;
      [this.heap[i], this.heap[m]] = [this.heap[m]!, this.heap[i]!];
      i = m;
    }
  }
}
