import { RNG } from '../core/rng.js';
import { Scheduler } from '../core/turn.js';
import type { XY } from '../core/grid.js';
import { Level, type LevelGen } from '../dungeon/level.js';
import { resetSpecials } from '../dungeon/rooms.js';
import { DEATH_MESSAGE_RE } from '../mechanics/buffs.js';
import {
  type ActionContext,
  type HeroActor,
  type HeroIntent,
  type MechanicsHooks,
  type MobActor,
  mobsToPlaced,
} from './seams.js';

export interface GameDeps {
  gen: LevelGen;
  mechanics: MechanicsHooks;
  /** Max message-log lines kept (default 200). */
  logCap?: number;
}

export type PumpResult = 'acted' | 'waiting' | 'over';

/**
 * Game: owns the run — rng, level, hero, mobs, scheduler, message log.
 * Fixed turn stepping: each pump() resolves exactly one actor's turn in
 * time order. The hero's turn waits on input; mobs drain through their AI.
 * UI reads state from here and never duplicates it (SPEC contract §6).
 *
 * All turn logic is delegated to MechanicsHooks (src/mechanics/); the engine
 * only routes intents, charges time, recomputes FOV, and keeps lists in sync.
 */
export class Game {
  rng: RNG;
  readonly seed: number;
  level: Level;
  hero: HeroActor;
  mobs: MobActor[] = [];
  readonly scheduler = new Scheduler();
  log: string[] = [];
  turnCount = 0;
  gameOver = false;

  /** Tap-to-move path; consumed one step per hero turn. */
  private path: XY[] = [];
  private pendingIntent: HeroIntent | null = null;
  private readonly deps: GameDeps;
  private readonly logCap: number;

  constructor(seed: number, deps: GameDeps) {
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.deps = deps;
    this.logCap = deps.logCap ?? 200;

    // Vanilla shuffles the special-room rotation once per run
    // (Room.shuffleTypes); reset it before depth-1 generation so a new run
    // never inherits rotation state mutated by a previous run.
    resetSpecials(this.rng);
    this.level = deps.gen.generate(this.rng, 1);
    this.hero = deps.mechanics.spawnHero(this.rng, this.level);
    this.mobs = deps.mechanics.spawnMobs(this.rng, this.level);
    this.placeHeroAtEntrance();

    this.scheduler.add(this.hero);
    for (const m of this.mobs) this.scheduler.add(m);
    this.afterAction();
    this.logMsg(`Depth 1 — the Sewers. Find the stairs down. (seed ${this.seed})`);
  }

  // --- input API (called by src/engine/input.ts) ---

  /** Queue a hero intent; manual input cancels any tap-to-move path. */
  queueIntent(intent: HeroIntent): void {
    if (this.gameOver) return;
    this.path = [];
    this.pendingIntent = intent;
  }

  /** Set a tap-to-move path (clears any pending manual intent). */
  setPath(path: XY[]): void {
    if (this.gameOver) return;
    this.pendingIntent = null;
    this.path = path;
  }

  /** Cancel pathfinding (e.g. new manual input arrived mid-path). */
  cancelPath(): void {
    this.path = [];
  }

  get pathLength(): number {
    return this.path.length;
  }

  get currentPath(): ReadonlyArray<XY> {
    return this.path;
  }

  // --- simulation ---

  /**
   * Advance the simulation by one actor turn.
   * 'acted' — a turn resolved (call again to keep draining mobs);
   * 'waiting' — hero's turn, no input yet; 'over' — run ended.
   */
  pump(): PumpResult {
    if (this.gameOver) return 'over';
    const next = this.scheduler.peek();
    if (!next) return 'over';

    if (next === this.hero) {
      const intent = this.nextHeroIntent();
      if (!intent) return 'waiting';
      this.scheduler.next(); // pop hero, advance clock
      // Engine owns the buff-tick call site; mechanics owns the tick logic.
      // Buffs tick on EVERY hero turn, including depth transitions.
      this.deps.mechanics.tickActorBuffs(this.hero, this.ctx());
      // Trap-seeded blobs evolve once per hero turn (vanilla Blob.act).
      this.deps.mechanics.evolveBlobs(this.ctx());
      // Level transitions are engine-owned; everything else is mechanics.
      let cost: number;
      let transitioned = false;
      if (intent.kind === 'descend') {
        transitioned = this.tryDescend();
        cost = 1;
      } else if (intent.kind === 'ascend') {
        transitioned = this.tryAscend();
        cost = 1;
      } else {
        cost = this.deps.mechanics.handleHeroIntent(intent, this.ctx());
      }
      // Hunger/regen tick on every hero turn, including depth transitions
      // (vanilla ticks Hunger on descend too, Hero.actDescend).
      if (this.hero.isAlive()) {
        this.deps.mechanics.tickHeroClock(this.hero, this.ctx(), cost);
      }
      if (!transitioned) {
        // A depth transition rebuilds the clock itself (changeDepth), with
        // the hero registered first — see vanilla Actor.init().
        this.scheduler.spend(this.hero, cost);
      }
      this.turnCount++;
      this.afterAction();
      this.checkHeroDeath();
      return 'acted';
    }

    const mob = next as MobActor;
    this.scheduler.next(); // pop mob, advance clock
    // Engine owns the buff-tick call site; mechanics owns the tick logic.
    this.deps.mechanics.tickActorBuffs(mob, this.ctx());
    const cost = this.deps.mechanics.actMob(mob, this.ctx());
    if (mob.isAlive()) {
      this.scheduler.spend(mob, cost);
    } else {
      this.removeMob(mob);
    }
    this.afterAction();
    // A mob's turn can kill the hero — end the run immediately so the death
    // screen shows without waiting for the hero's next turn.
    this.checkHeroDeath();
    return this.gameOver ? 'over' : 'acted';
  }

  /** Drain turns until the hero needs input or the run ends. Bounded. */
  drain(maxSteps = 1000): PumpResult {
    let r: PumpResult = 'acted';
    for (let i = 0; i < maxSteps; i++) {
      r = this.pump();
      if (r !== 'acted') break;
    }
    return r;
  }

  /** Descend the stairs: generate the next depth, move the hero, respawn. */
  descend(): void {
    const depth = this.level.depth + 1;
    this.changeDepth(depth);
    // Vanilla Hero.actDescend: depth transitions cost hunger (unless starving).
    this.deps.mechanics.applyTransitionHunger(this.hero);
    this.logMsg(`You descend to depth ${depth}.`);
  }

  /** Ascend (no-op on depth 1). */
  ascend(): void {
    if (this.level.depth <= 1) {
      this.logMsg('You cannot go back up from here.');
      return;
    }
    const depth = this.level.depth - 1;
    this.changeDepth(depth);
    // Vanilla Hero.actAscend: depth transitions cost hunger (unless starving).
    this.deps.mechanics.applyTransitionHunger(this.hero);
    this.logMsg(`You ascend to depth ${depth}.`);
  }

  /** Intent 'descend': only works standing on the down stairs. */
  private tryDescend(): boolean {
    const i = this.level.idx(this.hero.x, this.hero.y);
    if (i === this.level.stairsDown) {
      this.descend();
      return true;
    }
    this.logMsg('There are no stairs down here.');
    return false;
  }

  /** Intent 'ascend': only works standing on the up stairs. */
  private tryAscend(): boolean {
    const i = this.level.idx(this.hero.x, this.hero.y);
    if (i === this.level.stairsUp) {
      if (this.level.sealed) {
        // Boss-arena seal (SewerBossLevel.seal): the stairs are gone.
        this.logMsg('The dungeon is sealed shut!');
        return false;
      }
      this.ascend();
      return true;
    }
    this.logMsg('There are no stairs up here.');
    return false;
  }

  // --- internals ---

  private nextHeroIntent(): HeroIntent | null {
    if (this.pendingIntent) {
      const i = this.pendingIntent;
      this.pendingIntent = null;
      return i;
    }
    if (this.path.length > 0) {
      const step = this.path.shift()!;
      const dx = step.x - this.hero.x;
      const dy = step.y - this.hero.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 1) {
        this.path = []; // path went stale; stop
        return null;
      }
      const mob = this.level.mobAt(step.x, step.y);
      if (mob) {
        this.path = []; // bump into a fight: stop pathing, attack once
        const live = this.mobs.find((m) => m.id === mob.id);
        if (live) return { kind: 'attack', targetId: live.id };
        return null;
      }
      return { kind: 'move', dx, dy };
    }
    return null;
  }

  private afterAction(): void {
    this.level.updateFov(this.hero.x, this.hero.y, this.hero.sight);
    this.syncMobs();
    // A newly-seen hostile interrupts tap-to-move (vanilla behavior).
    if (this.path.length > 0 && this.mobs.some((m) => m.hostile && this.level.visible[this.level.idx(m.x, m.y)])) {
      this.path = [];
      this.logMsg('You stop: danger ahead.');
    }
  }

  private checkHeroDeath(): void {
    if (!this.hero.isAlive() && !this.gameOver) {
      this.gameOver = true;
      // Buff kills already logged their own vanilla death line (e.g.
      // "You burned to death...") via tickBuffs/tickHeroClock; only add the
      // generic fallback when nothing specific was logged.
      const last = this.log[this.log.length - 1] ?? '';
      if (!DEATH_MESSAGE_RE.test(last) && last !== 'You died...') {
        this.logMsg('You died...');
      }
    }
  }

  private ctx(): ActionContext {
    return {
      rng: this.rng,
      level: this.level,
      hero: this.hero,
      mobs: this.mobs,
      log: (msg: string) => this.logMsg(msg),
      killMob: (mob: MobActor) => this.removeMob(mob),
      addMob: (mob: MobActor, delay?: number) => {
        this.mobs.push(mob);
        mob.time = this.scheduler.now + (delay ?? 0);
        this.scheduler.add(mob);
        this.syncMobs();
      },
      syncMobs: () => this.syncMobs(),
    };
  }

  logMsg(msg: string): void {
    this.log.push(msg);
    if (this.log.length > this.logCap) {
      this.log.splice(0, this.log.length - this.logCap);
    }
  }

  private removeMob(mob: MobActor): void {
    this.mobs = this.mobs.filter((m) => m !== mob);
    this.scheduler.remove(mob);
    this.syncMobs();
  }

  private syncMobs(): void {
    this.level.mobs = mobsToPlaced(this.mobs);
  }

  private placeHeroAtEntrance(): void {
    const i = this.level.stairsUp;
    if (i >= 0) {
      this.hero.x = i % this.level.w;
      this.hero.y = Math.floor(i / this.level.w);
    } else {
      this.hero.x = 1;
      this.hero.y = 1;
    }
  }

  private changeDepth(depth: number): void {
    this.level = this.deps.gen.generate(this.rng, depth);
    for (const m of this.mobs) this.scheduler.remove(m);
    this.mobs = this.deps.mechanics.spawnMobs(this.rng, this.level);
    this.placeHeroAtEntrance();
    this.path = [];
    this.pendingIntent = null;
    // Fresh depth: reset the clock (vanilla keeps actor times, but with all
    // mobs respawned a clean clock is simpler and deterministic).
    // Vanilla Actor.init() registers the hero FIRST at -Float.MIN_VALUE, so
    // the hero always acts first on a fresh floor: mirror that by adding the
    // hero before the mobs — simultaneous times then break hero-first via
    // the scheduler's insertion-order tie-break.
    this.scheduler.now = 0;
    this.hero.time = 0;
    this.scheduler.add(this.hero);
    for (const m of this.mobs) {
      m.time = 0;
      this.scheduler.add(m);
    }
    this.afterAction();
  }
}
