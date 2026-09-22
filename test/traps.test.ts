/**
 * Trap + blob tests (Stage 0, worker 2/5).
 *
 * Grounded in the Java sources — every expectation cites the file and rule:
 *   - Level.press trap portion (Level.java:619-721): hero triggers hidden AND
 *     revealed traps; hidden logs "A hidden pressure plate clicks!"; every
 *     trigger is single-use (tile -> INACTIVE_TRAP).
 *   - Level.mobPress trap portion (Level.java:723-775): mobs trigger ONLY
 *     revealed traps; hidden never fires for mobs.
 *   - Effect formulas from the eight trap files under levels/traps/.
 *   - Blob diffusion + Fire/ToxicGas/ParalyticGas evolve from actors/blobs/.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain } from '../src/core/grid.js';
import { Level } from '../src/dungeon/level.js';
import type { ActionContext, MobActor } from '../src/engine/seams.js';
import { createStarterHero, type ContentHero } from '../src/content/hero.js';
import { buildMob, nextMobId, type ContentMob } from '../src/content/mobs.js';
import {
  makeBlobWorld,
  mobPressTrapCell,
  pressTrapCell,
  tickBleeding,
  trapKindOf,
  TXT_ALARM_SOUND,
  TXT_BLEEDING_DEATH,
  TXT_HIDDEN_PLATE_CLICKS,
  TXT_LIGHTNING_DEATH,
  bestiaryMobId,
  type TrapHero,
  type TrapMob,
  type TrapSummoner,
} from '../src/mechanics/traps.js';
import {
  createBlob,
  seedBlob,
  tickBlobs,
  TOXIC_GAS_DEATH_MESSAGE,
  type Blob,
  type BlobWorld,
} from '../src/mechanics/blobs.js';
import { ORIGINAL_SPRITES } from '../src/assets/original_sprites.js';

// --- helpers ---

function makeLevel(w = 12, h = 12, depth = 1): Level {
  const lvl = new Level(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) lvl.set(x, y, Terrain.FLOOR);
  }
  lvl.depth = depth;
  lvl.stairsUp = 5 * w + 5;
  return lvl;
}

interface Ctx {
  ctx: ActionContext;
  hero: ContentHero;
  logs: string[];
  added: ContentMob[];
  mobs: ContentMob[];
  removed: ContentMob[];
}

function makeCtx(level: Level, seed = 1234): Ctx {
  const rng = new RNG(seed);
  const hero = createStarterHero(5 * level.w + 5, level.w);
  const logs: string[] = [];
  const added: ContentMob[] = [];
  const removed: ContentMob[] = [];
  const mobs: ContentMob[] = [];
  const ctx: ActionContext = {
    rng,
    level,
    hero,
    mobs: mobs as unknown as MobActor[],
    log: (m: string) => logs.push(m),
    killMob: (m: MobActor) => {
      removed.push(m as ContentMob);
      const i = mobs.indexOf(m as ContentMob);
      if (i >= 0) mobs.splice(i, 1);
    },
    removeMob: (m: MobActor) => {
      const i = mobs.indexOf(m as ContentMob);
      if (i >= 0) mobs.splice(i, 1);
    },
    addMob: (m: MobActor, _delay?: number) => {
      added.push(m as ContentMob);
      mobs.push(m as ContentMob);
    },
    syncMobs: () => {},
  };
  return { ctx, hero, logs, added, mobs, removed };
}

/** Scripted deterministic rng built on the real RNG class; queues fall back to min. */
function scriptedRng(ints: number[] = [], floats: number[] = []): RNG {
  const rng = new RNG(1);
  let ii = 0;
  let fi = 0;
  rng.int = (min: number, _max: number) => ints[ii++] ?? min;
  rng.float = (min: number, _max: number) => floats[fi++] ?? min;
  rng.intRange = (min: number, _max: number) => ints[ii++] ?? min;
  rng.normalIntRange = (min: number, _max: number) => ints[ii++] ?? min;
  rng.pick = <T>(arr: readonly T[]): T => arr[(ints[ii++] ?? 0) % arr.length];
  return rng;
}

function placeTrap(level: Level, x: number, y: number, t: Terrain): number {
  level.set(x, y, t);
  return level.idx(x, y);
}

function worldOf(c: Ctx): BlobWorld {
  return makeBlobWorld(
    c.ctx,
    c.hero as unknown as TrapHero,
    c.mobs as unknown as TrapMob[],
  );
}

function fireBlobAt(c: Ctx, pos: number, amount: number): void {
  seedBlob(c.ctx.level.blobs, 'fire', pos, amount, c.ctx.level.w * c.ctx.level.h);
}

/** Total volume of the live blob of a kind (0 when absent). */
function blobVol(blobs: Blob[], kind: string): number {
  return blobs.find((b) => b.kind === kind)?.volume ?? 0;
}

// --- trapKindOf ---

describe('trapKindOf', () => {
  test('maps every hidden + revealed trap tile to its kind', () => {
    expect(trapKindOf(Terrain.TRAP_TOXIC)).toBe('toxic');
    expect(trapKindOf(Terrain.TRAP_TOXIC_HIDDEN)).toBe('toxic');
    expect(trapKindOf(Terrain.TRAP_FIRE)).toBe('fire');
    expect(trapKindOf(Terrain.TRAP_FIRE_HIDDEN)).toBe('fire');
    expect(trapKindOf(Terrain.TRAP_PARALYTIC)).toBe('paralytic');
    expect(trapKindOf(Terrain.TRAP_PARALYTIC_HIDDEN)).toBe('paralytic');
    expect(trapKindOf(Terrain.TRAP_POISON)).toBe('poison');
    expect(trapKindOf(Terrain.TRAP_POISON_HIDDEN)).toBe('poison');
    expect(trapKindOf(Terrain.TRAP_ALARM)).toBe('alarm');
    expect(trapKindOf(Terrain.TRAP_ALARM_HIDDEN)).toBe('alarm');
    expect(trapKindOf(Terrain.TRAP_LIGHTNING)).toBe('lightning');
    expect(trapKindOf(Terrain.TRAP_LIGHTNING_HIDDEN)).toBe('lightning');
    expect(trapKindOf(Terrain.TRAP_GRIPPING)).toBe('gripping');
    expect(trapKindOf(Terrain.TRAP_GRIPPING_HIDDEN)).toBe('gripping');
    expect(trapKindOf(Terrain.TRAP_SUMMONING)).toBe('summoning');
    expect(trapKindOf(Terrain.TRAP_SUMMONING_HIDDEN)).toBe('summoning');
    expect(trapKindOf(Terrain.FLOOR)).toBeNull();
    expect(trapKindOf(Terrain.TRAP_INACTIVE)).toBeNull();
  });
});

// --- trigger rules ---

describe('pressTrapCell (Level.press trap portion)', () => {
  test('hero on hidden trap logs the exact hidden-plate message (Level.java:94)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_TOXIC_HIDDEN);
    c.hero.pos = cell;
    pressTrapCell(c.ctx, cell, c.hero as unknown as TrapHero, () => {});
    expect(c.logs).toContain(TXT_HIDDEN_PLATE_CLICKS);
    expect(TXT_HIDDEN_PLATE_CLICKS).toBe('A hidden pressure plate clicks!');
  });

  test('hero triggers revealed traps too, and trigger is single-use', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_FIRE);
    c.hero.pos = cell;
    pressTrapCell(c.ctx, cell, c.hero as unknown as TrapHero, () => {});
    expect(lvl.getAt(cell)).toBe(Terrain.TRAP_INACTIVE);
    // second step on the inactive tile: nothing happens
    const logsBefore = c.logs.length;
    pressTrapCell(c.ctx, cell, c.hero as unknown as TrapHero, () => {});
    expect(c.logs.length).toBe(logsBefore);
  });

  test('seeds: toxic 300+20d, fire 2, paralytic 80+5d (trap files :34)', () => {
    const check = (
      t: Terrain,
      depth: number,
      kind: 'toxic' | 'fire' | 'paralytic',
      expected: number,
    ) => {
      const lvl = makeLevel(12, 12, depth);
      const c = makeCtx(lvl);
      const cell = placeTrap(lvl, 6, 6, t);
      c.hero.pos = cell;
      pressTrapCell(c.ctx, cell, c.hero as unknown as TrapHero, () => {});
      expect(blobVol(lvl.blobs, kind)).toBe(expected);
    };
    check(Terrain.TRAP_TOXIC, 1, 'toxic', 320);
    check(Terrain.TRAP_TOXIC, 3, 'toxic', 360);
    check(Terrain.TRAP_FIRE, 1, 'fire', 2);
    check(Terrain.TRAP_PARALYTIC, 1, 'paralytic', 85);
    check(Terrain.TRAP_PARALYTIC, 2, 'paralytic', 90);
  });

  test('poison trap sets poison buff to 4 + floor(depth/2) (PoisonTrap.java:34)', () => {
    const tryDepth = (depth: number, expected: number) => {
      const lvl = makeLevel(12, 12, depth);
      const c = makeCtx(lvl);
      const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_POISON);
      c.hero.pos = cell;
      pressTrapCell(c.ctx, cell, c.hero as unknown as TrapHero, () => {});
      expect(c.hero.buffs.poison?.left).toBe(expected);
      expect(lvl.getAt(cell)).toBe(Terrain.TRAP_INACTIVE);
    };
    tryDepth(1, 4); // 4 + floor(1/2)
    tryDepth(4, 6); // 4 + floor(4/2)
    tryDepth(5, 6); // 4 + floor(5/2)
  });
});

describe('mobPressTrapCell (Level.mobPress trap portion)', () => {
  test('mob on a HIDDEN trap does not trigger it', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_FIRE_HIDDEN);
    const mob = buildMob('rat', nextMobId(), cell, lvl.w);
    c.mobs.push(mob);
    mobPressTrapCell(c.ctx, mob as unknown as TrapMob, () => {});
    expect(lvl.getAt(cell)).toBe(Terrain.TRAP_FIRE_HIDDEN);
    expect(c.logs).toHaveLength(0);
    expect(blobVol(lvl.blobs, 'fire')).toBe(0);
  });

  test('mob on a REVEALED trap triggers it (single use)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_FIRE);
    const mob = buildMob('rat', nextMobId(), cell, lvl.w);
    c.mobs.push(mob);
    mobPressTrapCell(c.ctx, mob as unknown as TrapMob, () => {});
    expect(lvl.getAt(cell)).toBe(Terrain.TRAP_INACTIVE);
    expect(blobVol(lvl.blobs, 'fire')).toBe(2);
  });

  test('mob on revealed gripping trap is crippled + bleeds', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_GRIPPING);
    const mob = buildMob('rat', nextMobId(), cell, lvl.w);
    c.mobs.push(mob);
    const ctx2 = { ...c.ctx, rng: scriptedRng([1]) };
    mobPressTrapCell(ctx2, mob as unknown as TrapMob, () => {});
    // damage = max(0, (1+3) - 1) = 3
    expect(mob.buffs.bleeding?.level).toBe(3);
    expect(mob.buffs.cripple?.left).toBe(10);
  });
});

// --- alarm ---

describe('alarm trap', () => {
  test('beckons every mob except the triggerer; visible message exact', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_ALARM);
    lvl.visible[cell] = 1;
    const triggerer = buildMob('rat', nextMobId(), cell, lvl.w);
    triggerer.state = 'sleeping';
    const other = buildMob('gnoll', nextMobId(), lvl.idx(2, 2), lvl.w);
    other.state = 'sleeping';
    const hunter = buildMob('crab', nextMobId(), lvl.idx(3, 3), lvl.w);
    hunter.state = 'hunting';
    c.mobs.push(triggerer, other, hunter);
    mobPressTrapCell(c.ctx, triggerer as unknown as TrapMob, () => {});
    // triggerer untouched
    expect(triggerer.state).toBe('sleeping');
    expect(triggerer.target).toBe(-1);
    // sleeping mob becomes wandering, target = trap cell
    expect(other.state as string).toBe('wandering');
    expect(other.target).toBe(cell);
    // hunting mob keeps hunting but is retargeted (Mob.beckon, Mob.java:399)
    expect(hunter.state).toBe('hunting');
    expect(hunter.target).toBe(cell);
    expect(c.logs).toContain(TXT_ALARM_SOUND);
    expect(TXT_ALARM_SOUND).toBe(
      'The trap emits a piercing sound that echoes throughout the dungeon!',
    );
  });

  test('no message when the cell is not visible (GLog gated on visibility)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_ALARM);
    const triggerer = buildMob('rat', nextMobId(), cell, lvl.w);
    c.mobs.push(triggerer);
    mobPressTrapCell(c.ctx, triggerer as unknown as TrapMob, () => {});
    expect(c.logs).not.toContain(TXT_ALARM_SOUND);
  });
});

// --- lightning ---

describe('lightning trap', () => {
  test('damage = max(1, Int(HP/3, 2*HP/3)) (LightningTrap.java:34)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_LIGHTNING);
    c.hero.pos = cell;
    c.hero.hp = 30;
    // Int(10, 20) scripted to 17
    const ctx2 = { ...c.ctx, rng: scriptedRng([17]) };
    pressTrapCell(ctx2, cell, c.hero as unknown as TrapHero, () => {});
    expect(c.hero.hp).toBe(13);
    expect(lvl.getAt(cell)).toBe(Terrain.TRAP_INACTIVE);
  });

  test('minimum damage 1 when HP/3 rounds down; death logs exact line', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_LIGHTNING);
    c.hero.pos = cell;
    c.hero.hp = 1;
    const ctx2 = { ...c.ctx, rng: scriptedRng([0]) }; // Int(0, 1) = 0 -> max(1, 0)
    pressTrapCell(ctx2, cell, c.hero as unknown as TrapHero, () => {});
    expect(c.hero.hp).toBeLessThanOrEqual(0);
    expect(c.logs).toContain(TXT_LIGHTNING_DEATH);
    expect(TXT_LIGHTNING_DEATH).toBe(
      'You were killed by a discharge of a lightning trap...',
    );
  });
});

// --- gripping ---

describe('gripping trap', () => {
  test('bleed level = max(0, (depth+3) - IntRange(0, dr/2)), cripple 10', () => {
    const lvl = makeLevel(12, 12, 2); // depth 2 -> base 5
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_GRIPPING);
    const mob = buildMob('rat', nextMobId(), cell, lvl.w);
    c.mobs.push(mob);
    // rat dr = 0 -> IntRange(0, 0) scripted to 0 -> damage 5
    const ctx2 = { ...c.ctx, rng: scriptedRng([0]) };
    mobPressTrapCell(ctx2, mob as unknown as TrapMob, () => {});
    expect(mob.buffs.bleeding?.level).toBe(5);
    expect(mob.buffs.cripple?.left).toBe(10);
    // re-apply on a fresh trap prolongs cripple (Buff.prolong = max)
    const cell2 = placeTrap(lvl, 7, 7, Terrain.TRAP_GRIPPING);
    mob.pos = cell2;
    mob.buffs.cripple!.left = 7;
    mobPressTrapCell(ctx2, mob as unknown as TrapMob, () => {});
    expect(mob.buffs.cripple?.left).toBe(10);
  });
});

describe('tickBleeding (Bleeding.act, Bleeding.java:58-81)', () => {
  test('re-rolls level each tick; damages; detaches at 0', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const mob = buildMob('rat', nextMobId(), lvl.idx(6, 6), lvl.w);
    mob.hp = 20;
    mob.buffs.bleeding = { kind: 'bleeding', left: 0, level: 3 };
    // Int(0, 3) -> 1: new level 1, damage 1
    tickBleeding(c.ctx, scriptedRng([1]), mob as unknown as TrapMob);
    expect(mob.buffs.bleeding?.level).toBe(1);
    expect(mob.hp).toBe(19);
    // Int(0, 1) -> 0: detached, no damage, buff gone
    tickBleeding(c.ctx, scriptedRng([0]), mob as unknown as TrapMob);
    expect(mob.buffs.bleeding).toBeUndefined();
    expect(mob.hp).toBe(19);
  });

  test('hero death logs the exact bleeding line (Bleeding.java:70)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    c.hero.hp = 1;
    c.hero.buffs.bleeding = { kind: 'bleeding', left: 0, level: 3 };
    tickBleeding(c.ctx, scriptedRng([2]), c.hero as unknown as TrapHero);
    expect(c.hero.hp).toBeLessThanOrEqual(0);
    expect(c.logs).toContain(TXT_BLEEDING_DEATH);
    expect(TXT_BLEEDING_DEATH).toBe('You bled to death...');
  });
});

// --- summoning ---

describe('summoning trap', () => {
  test('boss level: no mobs, but the trap still deactivates', () => {
    const lvl = makeLevel();
    lvl.bossLevel = true;
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_SUMMONING);
    c.hero.pos = cell;
    const summons: string[] = [];
    const summon: TrapSummoner = (id) => summons.push(id);
    pressTrapCell(c.ctx, cell, c.hero as unknown as TrapHero, summon);
    expect(summons).toHaveLength(0);
    expect(c.added).toHaveLength(0);
    expect(lvl.getAt(cell)).toBe(Terrain.TRAP_INACTIVE);
  });

  test('spawns 1-3 Bestiary(depth) mobs on free passable neighbours', () => {
    const lvl = makeLevel(12, 12, 1);
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_SUMMONING);
    c.hero.pos = cell;
    // ints: 0 -> nMobs=2, 0 -> nMobs=3; picks 0,0,0 (first candidates)
    const ctx2 = {
      ...c.ctx,
      rng: scriptedRng([0, 0, 0, 0, 0], [0, 0, 0]), // floats: rat on depth 1
    };
    const spawned: { id: string; pos: number }[] = [];
    const summon: TrapSummoner = (id, pos) => spawned.push({ id, pos });
    pressTrapCell(ctx2, cell, c.hero as unknown as TrapHero, summon);
    expect(spawned).toHaveLength(3);
    expect(spawned.every((s) => s.id === 'rat')).toBe(true);
    // all spawned on 8-neighbours of the trap cell, none on the hero's cell
    const { x, y } = lvl.xy(cell);
    const nbs = new Set(lvl.neighbors8(x, y).map((n) => lvl.idx(n.x, n.y)));
    for (const s of spawned) {
      expect(nbs.has(s.pos)).toBe(true);
      expect(s.pos).not.toBe(cell);
    }
    expect(new Set(spawned.map((s) => s.pos)).size).toBe(3); // no doubles
  });

  test('occupied cells are excluded from candidates', () => {
    const lvl = makeLevel(12, 12, 1);
    const c = makeCtx(lvl);
    const cell = placeTrap(lvl, 6, 6, Terrain.TRAP_SUMMONING);
    c.hero.pos = cell;
    // occupy the (5,5) neighbour
    const blocker = buildMob('rat', nextMobId(), lvl.idx(5, 5), lvl.w);
    c.mobs.push(blocker);
    const ctx2 = { ...c.ctx, rng: scriptedRng([1], [0]) }; // nMobs = 1
    const spawned: number[] = [];
    const summon: TrapSummoner = (_id, pos) => spawned.push(pos);
    pressTrapCell(ctx2, cell, c.hero as unknown as TrapHero, summon);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).not.toBe(blocker.pos);
  });
});

describe('bestiaryMobId', () => {
  test('depth 1-4 tables match Bestiary.java chances', () => {
    const r = (v: number) => scriptedRng([], [v]);
    // depth 1: [1] -> rat
    expect(bestiaryMobId(r(0.5), 1)).toBe('rat');
    // depth 2: [1,1] -> rat / gnoll
    expect(bestiaryMobId(r(0.4), 2)).toBe('rat');
    expect(bestiaryMobId(r(1.5), 2)).toBe('gnoll');
    // depth 3: [1,2,1,0.02] -> rat / gnoll / crab / swarm
    expect(bestiaryMobId(r(0.9), 3)).toBe('rat');
    expect(bestiaryMobId(r(2.0), 3)).toBe('gnoll');
    expect(bestiaryMobId(r(3.5), 3)).toBe('crab');
    expect(bestiaryMobId(r(4.01), 3)).toBe('swarm');
    // depth 4: [1,2,3,0.02,0.01,0.01]
    expect(bestiaryMobId(r(0.9), 4)).toBe('rat');
    expect(bestiaryMobId(r(2.5), 4)).toBe('gnoll');
    expect(bestiaryMobId(r(5.0), 4)).toBe('crab');
    expect(bestiaryMobId(r(6.01), 4)).toBe('swarm');
    expect(bestiaryMobId(r(6.025), 4)).toBe('skeleton');
    expect(bestiaryMobId(r(6.035), 4)).toBe('thief');
  });
});

// --- blobs ---

describe('base Blob diffusion', () => {
  test('one evolve: cell value = floor(sum/count) - 1 (Blob.java:64-84)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = lvl.idx(6, 6);
    seedBlob(lvl.blobs, 'toxic', cell, 100, lvl.w * lvl.h);
    const blob = lvl.blobs.find((b) => b.kind === 'toxic')!;
    blob.act(c.ctx.rng, worldOf(c));
    // seeded cell: sum=100 (itself) + 4 zero neighbours, count=5 -> 20-1=19
    expect(blob.cur[cell]).toBe(19);
    // each 4-neighbour: sum = 100 from the seeded cell -> 19
    for (const n of lvl.neighbors4(6, 6)) {
      expect(blob.cur[lvl.idx(n.x, n.y)]).toBe(19);
    }
    // diagonal untouched
    expect(blob.cur[lvl.idx(5, 5)]).toBe(0);
  });

  test('solid tiles are excluded from the average', () => {
    const lvl = makeLevel();
    lvl.set(6, 5, Terrain.WALL); // north neighbour solid
    const c = makeCtx(lvl);
    const cell = lvl.idx(6, 6);
    seedBlob(lvl.blobs, 'toxic', cell, 100, lvl.w * lvl.h);
    const blob = lvl.blobs.find((b) => b.kind === 'toxic')!;
    blob.act(c.ctx.rng, worldOf(c));
    // count = itself + 3 open neighbours = 4 -> 25-1 = 24
    expect(blob.cur[cell]).toBe(24);
    // solid cell never receives gas
    expect(blob.cur[lvl.idx(6, 5)]).toBe(0);
  });
});

describe('fire blob evolve', () => {
  test('existing fire decrements by 1 each evolve', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = lvl.idx(6, 6);
    fireBlobAt(c, cell, 2);
    const blob = lvl.blobs.find((b) => b.kind === 'fire')!;
    tickBlobs(c.ctx.rng, worldOf(c), lvl.blobs);
    expect(blob.cur[cell]).toBe(1);
    tickBlobs(c.ctx.rng, worldOf(c), lvl.blobs);
    expect(blob.cur[cell]).toBe(0);
  });

  test('flamable neighbour ignites at 4', () => {
    const lvl = makeLevel();
    lvl.set(6, 5, Terrain.HIGH_GRASS);
    const c = makeCtx(lvl);
    const cell = lvl.idx(6, 6);
    fireBlobAt(c, cell, 2);
    tickBlobs(c.ctx.rng, worldOf(c), lvl.blobs);
    
    const grass = lvl.idx(6, 5);
    const blob = lvl.blobs.find((b) => b.kind === 'fire')!;
    expect(blob.cur[grass]).toBe(4);
  });

  test('seed does nothing when the cell already burns (Fire.seed)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = lvl.idx(6, 6);
    fireBlobAt(c, cell, 2);
    fireBlobAt(c, cell, 2);
    expect(blobVol(lvl.blobs, 'fire')).toBe(2);
  });

  test('char standing in fire is reignited (Burning left=8); no direct damage (Fire.java burn)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = lvl.idx(6, 6);
    c.hero.pos = cell;
    c.hero.hp = 50;
    fireBlobAt(c, cell, 2);
    tickBlobs(c.ctx.rng, worldOf(c), lvl.blobs);
    // burn() only reignites the buff — the 1-3 HP damage ticks via Burning.act
    expect(c.hero.hp).toBe(50);
    expect(c.hero.buffs.burning?.left).toBe(8);
  });
});

describe('toxic gas evolve', () => {
  test('damage = floor((HT + 5 + 5*depth)/40), +1 on fractional roll', () => {
    const lvl = makeLevel(12, 12, 1); // levelDamage = 10
    const c = makeCtx(lvl);
    const cell = lvl.idx(6, 6);
    c.hero.pos = cell;
    c.hero.ht = 100;
    c.hero.hp = 100;
    seedBlob(lvl.blobs, 'toxic', cell, 300, lvl.w * lvl.h);
    // (100 + 10) / 40 = 2 rem 30 -> Int(40)=20 < 30 -> 3 damage
    const ctx2 = { ...c.ctx, rng: scriptedRng([20]) };
    tickBlobs(ctx2.rng, worldOf({ ...c, ctx: ctx2 }), lvl.blobs);
    expect(c.hero.hp).toBe(97);
    // Int(40)=35 >= 30 -> 2 damage
    c.hero.hp = 100;
    const ctx3 = { ...c.ctx, rng: scriptedRng([35]) };
    tickBlobs(ctx3.rng, worldOf({ ...c, ctx: ctx3 }), lvl.blobs);
    expect(c.hero.hp).toBe(98);
  });

  test('hero death logs the exact toxic death line (ToxicGas.java:69-71)', () => {
    const lvl = makeLevel(12, 12, 5); // levelDamage = 30
    const c = makeCtx(lvl);
    const cell = lvl.idx(6, 6);
    c.hero.pos = cell;
    c.hero.ht = 20;
    c.hero.hp = 1;
    seedBlob(lvl.blobs, 'toxic', cell, 300, lvl.w * lvl.h);
    const ctx2 = { ...c.ctx, rng: scriptedRng([39]) };
    tickBlobs(ctx2.rng, worldOf({ ...c, ctx: ctx2 }), lvl.blobs);
    expect(c.hero.hp).toBeLessThanOrEqual(0);
    expect(c.logs).toContain(TOXIC_GAS_DEATH_MESSAGE);
    expect(TOXIC_GAS_DEATH_MESSAGE).toBe('You died from a toxic gas..');
  });
});

describe('paralytic gas evolve', () => {
  test('any char in gas is prolonged to at least 10 turns paralysis', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = lvl.idx(6, 6);
    c.hero.pos = cell;
    seedBlob(lvl.blobs, 'paralytic', cell, 100, lvl.w * lvl.h);
    tickBlobs(c.ctx.rng, worldOf(c), lvl.blobs);
    expect(c.hero.paralysed).toBe(true);
    expect(c.hero.buffs.paralysis?.left).toBeGreaterThanOrEqual(10);
  });

  test('prolong keeps the longer existing duration', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const cell = lvl.idx(6, 6);
    c.hero.pos = cell;
    c.hero.buffs.paralysis = { kind: 'paralysis', left: 25 };
    c.hero.paralysed = true;
    seedBlob(lvl.blobs, 'paralytic', cell, 100, lvl.w * lvl.h);
    tickBlobs(c.ctx.rng, worldOf(c), lvl.blobs);
    expect(c.hero.buffs.paralysis?.left).toBe(25);
  });
});

describe('createBlob / blobOf / makeBlob', () => {
  test('blob factory builds the three kinds with the right schema', () => {
    expect(createBlob('fire', 10).kind).toBe('fire');
    expect(createBlob('toxic', 10).kind).toBe('toxic');
    expect(createBlob('paralytic', 10).kind).toBe('paralytic');
    const b = createBlob('fire', 5);
    b.seed(3, 7);
    expect(b.cur[3]).toBe(7);
    expect(b.volume).toBe(7);
  });

  test('blobOf sums volume; zero when the blob is absent', () => {
    expect(blobVol([], 'fire')).toBe(0);
    const blobs = [createBlob('fire', 5), createBlob('toxic', 5)];
    blobs[0].seed(0, 4);
    blobs[1].seed(1, 9);
    expect(blobVol(blobs, 'fire')).toBe(4);
    expect(blobVol(blobs, 'paralytic')).toBe(0);
  });
});

// --- smoke: trap art keys exist ---

describe('trap sprite keys', () => {
  test('all eight revealed + eight secret trap sprite keys exist (original_sprites.ts)', () => {
    for (const k of [
      'trap_toxic', 'trap_fire', 'trap_paralytic', 'trap_poison',
      'trap_alarm', 'trap_lightning', 'trap_gripping', 'trap_summoning',
      'trap_toxic_secret', 'trap_fire_secret', 'trap_paralytic_secret',
      'trap_poison_secret', 'trap_alarm_secret', 'trap_lightning_secret',
      'trap_gripping_secret', 'trap_summoning_secret',
    ]) {
      expect(ORIGINAL_SPRITES[k], k).toBeDefined();
    }
  });
});
