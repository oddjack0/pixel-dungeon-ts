import type { RNG } from '../core/rng.js';
import type { TurnTaker } from '../core/turn.js';
import type { Level, PlacedMob } from '../dungeon/level.js';

/**
 * Engine <-> mechanics seam (SPEC: "Game delegates turn actions to callbacks").
 *
 * OWNERSHIP: the mechanics designer owns src/mechanics/ (Hero, Mob, combat
 * formulas, hunger, buffs, Goo AI) and implements `MechanicsHooks`. The engine
 * never guesses at formulas; it only routes intents and drains the scheduler.
 */

/** Player intent, produced by src/engine/input.ts, consumed by Game. */
export type HeroIntent =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'wait' }
  | { kind: 'pickup' }
  | { kind: 'attack'; targetId: number }
  | { kind: 'descend' }
  | { kind: 'ascend' }
  | { kind: 'useItem'; slot: number }
  | { kind: 'search' }
  // --- UI-proposed item intents (M1): the inventory panel queues these;
  // the mechanics worker implements them in handleHeroIntent. `slot` is the
  // UiItem slot index (see src/ui/inventory.ts).
  | { kind: 'equip'; slot: number }
  | { kind: 'drop'; slot: number }
  | { kind: 'throwItem'; slot: number; targetId: number };

/**
 * Structural view of the hero the engine needs. The real Hero class
 * (src/mechanics/char.ts) implements this.
 */
export interface HeroActor extends TurnTaker {
  x: number;
  y: number;
  hp: number;
  ht: number;
  name: string;
  sprite: string;
  /** FOV radius; vanilla hero sees 8. */
  sight: number;
  isAlive(): boolean;
}

/**
 * Structural view of a mob. The real Mob class implements this;
 * `act()` is the mob's AI (Goo AI included), driven by the scheduler.
 */
export interface MobActor extends TurnTaker {
  id: number;
  x: number;
  y: number;
  hp: number;
  ht: number;
  name: string;
  sprite: string;
  hostile: boolean;
  isAlive(): boolean;
  act(): number;
}

/** Everything a turn action may touch. Passed to every mechanics callback. */
export interface ActionContext {
  rng: RNG;
  level: Level;
  hero: HeroActor;
  mobs: MobActor[];
  log(msg: string): void;
  /** Remove a dead mob from the level + scheduler. Engine-provided. */
  killMob(mob: MobActor): void;
  /**
   * Add a mob mid-turn (e.g. the swarm split, Swarm.java:101).
   * The engine wires it into the scheduler with the given delay.
   */
  addMob(mob: MobActor, delay?: number): void;
  /** Sync engine's structural mob list with the level model (HUD/minimap). */
  syncMobs(): void;
}

/**
 * Implemented by the mechanics worker. All callbacks are pure turn logic:
 * they mutate hero/mobs/level and RETURN the time cost in turn units
 * (Actor.TICK = 1 for a standard action).
 */
export interface MechanicsHooks {
  /** Resolve one hero intent. Returns its time cost. */
  handleHeroIntent(intent: HeroIntent, ctx: ActionContext): number;
  /** One mob's AI turn. Returns its time cost. */
  actMob(mob: MobActor, ctx: ActionContext): number;
  /** Tick buffs on an actor at the start of its turn (engine owns the call site). */
  tickActorBuffs(actor: HeroActor | MobActor, ctx: ActionContext): void;
  /**
   * Evolve trap-seeded blobs one round (vanilla Blob.act -> evolve()).
   * Engine owns the call site (once per hero turn — the round beat);
   * mechanics owns the tick logic.
   */
  evolveBlobs(ctx: ActionContext): void;
  /**
   * Tick the hero's hunger/regen clock by `cost` time units at the end of the
   * hero's turn (engine owns the call site; mechanics owns the tick logic).
   * The engine calls this for every hero turn, including depth transitions.
   */
  tickHeroClock(actor: HeroActor, ctx: ActionContext, cost: number): void;
  /**
   * Vanilla Hero.actDescend/actAscend: when a depth transition actually
   * occurs, hunger increases by STARVING/10 (satisfy(-STARVING/10)) unless
   * the hero is already starving (Hero.java actDescend/actAscend). Engine
   * owns the call site (it knows when a transition happens); mechanics owns
   * the hunger logic.
   */
  applyTransitionHunger(actor: HeroActor): void;
  /** Spawn the hero for a fresh run. */
  spawnHero(rng: RNG, level: Level): HeroActor;
  /** Spawn mobs for a fresh level (empty array is fine pre-content). */
  spawnMobs(rng: RNG, level: Level): MobActor[];
  /** Rebuild a hero from save data (see docs/ENGINE-REPORT.md §save format). */
  reviveHero(rng: RNG, data: HeroSaveData): HeroActor;
  /** Rebuild a mob from save data. */
  reviveMob(rng: RNG, data: MobSaveData): MobActor;
  /** Serialize hero state for save/load. */
  saveHero(hero: HeroActor): HeroSaveData;
  /** Serialize mob state for save/load. */
  saveMob(mob: MobActor): MobSaveData;
}

/** Opaque save blobs — mechanics owns their schema (documented in ENGINE-REPORT). */
export type HeroSaveData = Record<string, unknown>;
export type MobSaveData = Record<string, unknown>;

/** Keep the level model's structural mob list in sync with live mobs. */
export function mobsToPlaced(mobs: MobActor[]): PlacedMob[] {
  return mobs.map((m) => ({
    id: m.id,
    x: m.x,
    y: m.y,
    hp: m.hp,
    ht: m.ht,
    name: m.name,
    sprite: m.sprite,
    hostile: m.hostile,
  }));
}
