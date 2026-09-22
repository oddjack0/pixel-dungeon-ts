/**
 * Stage 0 blob system — faithful port of the vanilla gas/fire actors:
 *   actors/blobs/Blob.java, Fire.java, ToxicGas.java, ParalyticGas.java
 *
 * STAGE 0 SCOPE: only the three blobs seeded by traps (Fire, ToxicGas,
 * ParalyticGas). This module is the foundation the later full 14-blob
 * system extends: `BlobKind` gains the remaining kinds, `BlobWorld` gains
 * the remaining world hooks, subclasses override `evolve` per their Java.
 *
 * Conventions (match the existing mechanics layer: pure formulas + an env
 * interface the content/engine side implements):
 * - Blob state (cur/off/volume) lives in the Blob instance, exactly like
 *   vanilla (Blob.java: cur/off int arrays, volume).
 * - `act()` = vanilla Blob.act() (spend TICK; if volume > 0: evolve + swap).
 *   The engine is expected to call `tickBlobs()` once per turn for every
 *   live blob (vanilla: blobs are Actors in the scheduler).
 * - `evolve()` implementations are verbatim translations of the Java
 *   evolve() methods, including vanilla quirks (documented inline).
 *
 * Blob registry: vanilla `Dungeon.level.blobs` (Map<Class, Blob>). Here the
 * Level owns `blobs: Blob[]` (see dungeon/level.ts); `seedBlob` is the port
 * of `Blob.seed(cell, amount, type)`.
 */
import type { MechanicsRng } from './rng.js';
import type { BuffKind } from './buffs.js';
import type { BuffState } from './char.js';
import { BURNING_DURATION, PARALYSIS_DURATION } from './buffs.js';
import { Terrain } from '../core/grid.js';

/** The Stage 0 blobs (trap-seeded) plus the spinner's web (Stage 2). */
export type BlobKind = 'fire' | 'toxic' | 'paralytic' | 'web';

/**
 * Minimal char surface a blob evolve needs (vanilla Actor.findChar + Char).
 * TrapChar (mechanics/traps.ts) satisfies this structurally.
 */
export interface BlobChar {
  pos: number;
  hp: number;
  ht: number;
  paralysed: boolean;
  /** Set while a Roots buff is attached (Roots.attachTo, Roots.java). */
  rooted: boolean;
  /** Flying chars refuse Roots (Roots.attachTo, Roots.java). */
  flying: boolean;
  buffs: Partial<Record<BuffKind, BuffState>>;
  immunities: string[];
  resistances: string[];
  /** NPC.add(Buff) is a no-op (NPC.java:41-43): blobs can't buff NPCs. */
  invulnerable?: boolean;
  isAlive(): boolean;
}

/**
 * World surface a blob evolve needs. Implemented by the trap layer
 * (mechanics/traps.ts) over the Level + ActionContext.
 */
export interface BlobWorld {
  /** Level width (vanilla Level.WIDTH = 32). */
  w: number;
  /** Total cells (w * h). */
  length: number;
  /** Current depth (vanilla Dungeon.depth; ToxicGas damage scaling). */
  depth: number;
  /** All live blobs on the level (vanilla Dungeon.level.blobs). */
  blobs: Blob[];
  /** Vanilla Level.solid. */
  solidAt(pos: number): boolean;
  /** Vanilla Level.flamable. */
  flamableAt(pos: number): boolean;
  tileAt(pos: number): number;
  setTile(pos: number, tile: number): void;
  /** Vanilla Actor.findChar. */
  charAt(pos: number): BlobChar | null;
  visibleAt(pos: number): boolean;
  /**
   * Vanilla Char.damage(dmg, src): immunity/resistance tags, paralysis
   * break, HP update, death handling. `onHeroDeath` runs the source's
   * death message when the hero dies (e.g. ToxicGas.onDeath).
   */
  damageChar(
    rng: MechanicsRng,
    ch: BlobChar,
    dmg: number,
    sourceTag: string,
    onHeroDeath?: (ch: BlobChar) => void,
  ): void;
  /** Vanilla Buff.affect(ch, Burning.class).reignite(ch). */
  reigniteBurning(ch: BlobChar): void;
  /** Vanilla Buff.prolong(ch, Paralysis.class, Paralysis.duration(ch)). */
  prolongParalysis(ch: BlobChar, duration: number): void;
  /**
   * Vanilla Buff.prolong(ch, Roots.class, TICK) (Web.evolve, Web.java).
   * Refused by flying chars (Roots.attachTo, Roots.java).
   */
  prolongRoots(ch: BlobChar): void;
  /**
   * Vanilla Fire burning out on a flamable tile: Dungeon.level.destroy(pos)
   * + GameScene.updateMap(pos) + Dungeon.observe() + discoverTile when
   * visible.
   */
  burnOutTile(pos: number): void;
  log(msg: string): void;
}

/**
 * Tile solidity for blob spread, from Terrain.flags (Terrain.java).
 * SOLID flags in vanilla: WALL, DOOR, LOCKED_DOOR, BARRICADE, STATUE,
 * STATUE_SP, BOOKSHELF (= BARRICADE flags), LOCKED_EXIT.
 */
export function isSolidForBlob(t: Terrain): boolean {
  return (
    t === Terrain.WALL ||
    t === Terrain.DOOR ||
    t === Terrain.DOOR_LOCKED ||
    t === Terrain.DOOR_SECRET ||
    t === Terrain.BARRICADE ||
    t === Terrain.STATUE ||
    t === Terrain.BOOKSHELF ||
    t === Terrain.EXIT_LOCKED
  );
}

/**
 * Tile flamability for fire spread, from Terrain.flags (Terrain.java).
 * FLAMABLE flags in vanilla: GRASS, DOOR, OPEN_DOOR, BARRICADE, HIGH_GRASS,
 * SIGN, BOOKSHELF (= BARRICADE flags).
 */
export function isFlamableForBlob(t: Terrain): boolean {
  return (
    t === Terrain.GRASS ||
    t === Terrain.HIGH_GRASS ||
    t === Terrain.DOOR ||
    t === Terrain.BARRICADE ||
    t === Terrain.BOOKSHELF
  );
}

/**
 * Vanilla Blob (Blob.java). cur/off are the double-buffered gas maps;
 * volume is the total gas amount (drives act() + save).
 */
export class Blob {
  readonly kind: BlobKind;
  cur: Int32Array;
  off: Int32Array;
  volume = 0;

  constructor(kind: BlobKind, length: number) {
    this.kind = kind;
    this.cur = new Int32Array(length);
    this.off = new Int32Array(length);
  }

  /**
   * Vanilla Blob.act() (Blob.java): spend(TICK); if volume > 0:
   * volume = 0, evolve(), swap off/cur.
   */
  act(rng: MechanicsRng, world: BlobWorld): void {
    if (this.volume > 0) {
      this.volume = 0;
      this.evolve(rng, world);
      const tmp = this.off;
      this.off = this.cur;
      this.cur = tmp;
    }
  }

  /**
   * Vanilla Blob.evolve() (Blob.java): diffuse into the 4-neighbourhood
   * over non-solid cells; each cell keeps avg(neighbourhood) - 1.
   *   value = sum >= count ? (sum / count) - 1 : 0   (int division)
   */
  evolve(_rng: MechanicsRng, world: BlobWorld): void {
    const { w } = world;
    const h = world.length / w;
    const { cur, off } = this;
    for (let y = 1; y < h - 1; y++) {
      const from = y * w + 1;
      const to = from + w - 2;
      for (let pos = from; pos < to; pos++) {
        if (!world.solidAt(pos)) {
          let count = 1;
          let sum = cur[pos];
          if (!world.solidAt(pos - 1)) {
            sum += cur[pos - 1];
            count++;
          }
          if (!world.solidAt(pos + 1)) {
            sum += cur[pos + 1];
            count++;
          }
          if (!world.solidAt(pos - w)) {
            sum += cur[pos - w];
            count++;
          }
          if (!world.solidAt(pos + w)) {
            sum += cur[pos + w];
            count++;
          }
          const value = sum >= count ? Math.floor(sum / count) - 1 : 0;
          off[pos] = value;
          this.volume += value;
        } else {
          off[pos] = 0;
        }
      }
    }
  }

  /** Vanilla Blob.seed(cell, amount): cur[cell] += amount; volume += amount. */
  seed(cell: number, amount: number): void {
    this.cur[cell] += amount;
    this.volume += amount;
  }

  /** Vanilla Blob.clear(cell). */
  clear(cell: number): void {
    this.volume -= this.cur[cell];
    this.cur[cell] = 0;
  }
}

/** Vanilla Fire blob (actors/blobs/Fire.java). */
export class FireBlob extends Blob {
  constructor(length: number) {
    super('fire', length);
  }

  /**
   * Vanilla Fire.evolve() (Fire.java): burning cells tick down; flamable
   * neighbours of fire ignite at 4; a cell whose fire burns out on a
   * flamable tile destroys the tile (Level.destroy). burn() reignites
   * Burning on chars standing in fire.
   */
  override evolve(_rng: MechanicsRng, world: BlobWorld): void {
    const { w, length } = world;
    const { cur, off } = this;
    const from = w + 1;
    const to = length - w - 1;
    let observe = false;

    for (let pos = from; pos < to; pos++) {
      let fire: number;
      if (cur[pos] > 0) {
        this.burn(world, pos);
        fire = cur[pos] - 1;
        if (fire <= 0 && world.flamableAt(pos)) {
          // Vanilla: oldTile = map[pos]; level.destroy(pos); updateMap(pos);
          // if visible: discoverTile(pos, oldTile). observe -> Dungeon.observe().
          world.burnOutTile(pos);
          observe = true;
        }
      } else {
        if (
          world.flamableAt(pos) &&
          (cur[pos - 1] > 0 ||
            cur[pos + 1] > 0 ||
            cur[pos - w] > 0 ||
            cur[pos + w] > 0)
        ) {
          fire = 4;
          this.burn(world, pos);
        } else {
          fire = 0;
        }
      }
      this.volume += off[pos] = fire;
    }
    void observe; // Dungeon.observe() is an FOV refresh; the engine owns it.
  }

  /** Vanilla Fire.burn(pos): reignite Burning on the char there (Fire.java). */
  private burn(world: BlobWorld, pos: number): void {
    const ch = world.charAt(pos);
    if (ch !== null) {
      world.reigniteBurning(ch);
    }
    // Heap burning (Heap.burn): M1 has no item heaps on the ground model — skip.
  }

  /**
   * Vanilla Fire.seed(cell, amount) override (Fire.java): only seeds when
   * the cell has no fire yet (no stacking).
   */
  override seed(cell: number, amount: number): void {
    if (this.cur[cell] === 0) {
      this.volume += amount;
      this.cur[cell] = amount;
    }
  }
}

/** Exact vanilla death line for toxic gas (ToxicGas.java:69-71). */
export const TOXIC_GAS_DEATH_MESSAGE = 'You died from a toxic gas..';

/** Vanilla ToxicGas blob (actors/blobs/ToxicGas.java). */
export class ToxicGasBlob extends Blob {
  constructor(length: number) {
    super('toxic', length);
  }

  /**
   * Vanilla ToxicGas.evolve() (ToxicGas.java):
   *   levelDamage = 5 + depth * 5
   *   per char on gas: damage = (HT + levelDamage) / 40 (int division),
   *     +1 when Random.Int(40) < (HT + levelDamage) % 40
   *   then the paralytic-gas interaction (ported verbatim, quirk included:
   *   it zeroes cur[] AFTER the spread was computed into off[], so the
   *   spread itself is unaffected — only the volume bookkeeping changes;
   *   see the faithful-port note in traps.ts).
   */
  override evolve(rng: MechanicsRng, world: BlobWorld): void {    super.evolve(rng, world);

    const levelDamage = 5 + world.depth * 5;

    for (let i = 0; i < world.length; i++) {
      if (this.cur[i] > 0) {
        const ch = world.charAt(i);
        if (ch !== null) {
          let damage = Math.floor((ch.ht + levelDamage) / 40);
          if (rng.int(0, 40) < (ch.ht + levelDamage) % 40) {
            damage++;
          }
          world.damageChar(rng, ch, damage, 'toxic_gas', (dead) => {
            // ToxicGas.onDeath (ToxicGas.java): Badges.validateDeathFromGas()
            // is a Stage 6 badge hook; Dungeon.fail is the engine's game
            // over. The GLog line is exact.
            world.log(TOXIC_GAS_DEATH_MESSAGE);
            void dead;
          });
        }
      }
    }

    const par = world.blobs.find((b) => b.kind === 'paralytic');
    if (par != null) {
      const parCur = par.cur;
      for (let i = 0; i < world.length; i++) {
        const t = this.cur[i];
        const p = parCur[i];
        if (p >= t) {
          this.volume -= t;
          this.cur[i] = 0;
        } else {
          par.volume -= p;
          parCur[i] = 0;
        }
      }
    }
  }
}

/** Vanilla ParalyticGas blob (actors/blobs/ParalyticGas.java). */
export class ParalyticGasBlob extends Blob {
  constructor(length: number) {
    super('paralytic', length);
  }

  /**
   * Vanilla ParalyticGas.evolve() (ParalyticGas.java): every char standing
   * in gas gets Paralysis prolonged by Paralysis.duration(ch) = 10
   * (no Resistance ring in M1; PARALYSIS_DURATION in buffs.ts).
   */
  override evolve(_rng: MechanicsRng, world: BlobWorld): void {
    super.evolve(_rng, world);
    for (let i = 0; i < world.length; i++) {
      if (this.cur[i] > 0) {
        const ch = world.charAt(i);
        if (ch !== null) {
          world.prolongParalysis(ch, PARALYSIS_DURATION);
        }
      }
    }
  }
}

/** Vanilla Web blob (actors/blobs/Web.java) — the spinner's cobweb. */
export class WebBlob extends Blob {
  constructor(length: number) {
    super('web', length);
  }

  /**
   * Vanilla Web.evolve() (Web.java): no diffusion — each cell decays by 1,
   * and chars standing in live web get Roots prolonged by TICK (1).
   */
  override evolve(_rng: MechanicsRng, world: BlobWorld): void {
    for (let i = 0; i < world.length; i++) {
      const offv = this.cur[i] > 0 ? this.cur[i] - 1 : 0;
      this.off[i] = offv;
      if (offv > 0) {
        this.volume += offv;
        const ch = world.charAt(i);
        if (ch !== null) {
          world.prolongRoots(ch);
        }
      }
    }
  }

  /**
   * Vanilla Web.seed(cell, amount) (Web.java): raise to the amount, never
   * stack — unlike the base Blob.seed which adds.
   */
  override seed(cell: number, amount: number): void {
    const diff = amount - this.cur[cell];
    if (diff > 0) {
      this.cur[cell] = amount;
      this.volume += diff;
    }
  }
}

/** Construct the Blob subclass for a kind. */
export function createBlob(kind: BlobKind, length: number): Blob {
  switch (kind) {
    case 'fire':
      return new FireBlob(length);
    case 'toxic':
      return new ToxicGasBlob(length);
    case 'paralytic':
      return new ParalyticGasBlob(length);
    case 'web':
      return new WebBlob(length);
  }
}

/** Find the live blob of a kind on the level (vanilla level.blobs.get). */
export function blobOf(blobs: Blob[], kind: BlobKind): Blob | undefined {
  return blobs.find((b) => b.kind === kind);
}

/**
 * Vanilla Blob.seed(cell, amount, type) static (Blob.java): fetch-or-create
 * the level's blob of that class, then seed it. Returns the blob.
 */
export function seedBlob(
  blobs: Blob[],
  kind: BlobKind,
  cell: number,
  amount: number,
  length: number,
): Blob {
  let blob = blobOf(blobs, kind);
  if (!blob) {
    blob = createBlob(kind, length);
    blobs.push(blob);
  }
  blob.seed(cell, amount);
  return blob;
}

/**
 * Tick every live blob once (vanilla: each blob is an Actor spending TICK).
 * The engine should call this once per turn.
 */
export function tickBlobs(
  rng: MechanicsRng,
  world: BlobWorld,
  blobs: Blob[],
): void {
  for (const blob of blobs) {
    blob.act(rng, world);
  }
}
