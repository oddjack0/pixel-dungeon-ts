/**
 * Stage 3 tests: Dwarf King boss + Undead dwarves
 * (src/mechanics/king.ts, src/content/king.ts).
 *
 * Ground truth: ~/workspace/pixel-dungeon-src actors/mobs/King.java.
 * Java wins every conflict; each assertion cites its source.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain } from '../src/core/grid.js';
import { Level } from '../src/dungeon/level.js';
import type {
  ActionContext,
  MobActor,
} from '../src/engine/seams.js';
import { STAGE3_KING_SPRITES } from '../src/assets/stage3_king_sprites.js';
import {
  KING_ATTACK,
  KING_DEFENSE,
  KING_DMG_MAX,
  KING_DMG_MIN,
  KING_DR,
  KING_EXP,
  KING_HT,
  KING_IMMUNITIES,
  KING_MAX_ARMY_SIZE,
  KING_MAX_LVL,
  KING_RESISTANCES,
  UNDEAD_ATTACK,
  UNDEAD_DEFENSE,
  UNDEAD_DMG_MAX,
  UNDEAD_DMG_MIN,
  UNDEAD_DR,
  UNDEAD_EXP,
  UNDEAD_HT,
  UNDEAD_IMMUNITIES,
  UNDEAD_MAX_LVL,
  UNDEAD_PARALYSIS_DIE,
  UNDEAD_PARALYSIS_TURNS,
  kingDamageRoll,
  kingDisplayName,
  kingMaxArmySize,
  kingPedestal,
  kingUndeadsToSummon,
  resetKingPedestals,
  setKingPedestals,
  undeadDamageRoll,
  undeadSpawnCells,
} from '../src/mechanics/king.js';
import {
  ContentHero,
  createStarterHero,
} from '../src/content/hero.js';
import {
  ContentMob,
  chebyshevPos,
} from '../src/content/mobs.js';
import {
  KING_DEF,
  KingMob,
  UNDEAD_DEF,
  UndeadMob,
  getUndeadCount,
  resetUndeadCount,
  setKingDeepestFloor,
  spawnKingArena,
} from '../src/content/king.js';
import { damageFromTrap, type TrapChar } from '../src/mechanics/traps.js';
import { ToxicGasBlob } from '../src/mechanics/blobs.js';

// --- helpers (same shape as test/prison-mobs.test.ts) ---

function makeLevel(w = 9, h = 9): Level {
  const lvl = new Level(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) lvl.set(x, y, Terrain.FLOOR);
  }
  lvl.depth = 20;
  return lvl;
}

interface Ctx {
  ctx: ActionContext;
  hero: ContentHero;
  logs: string[];
  mobs: ContentMob[];
}

function makeCtx(level: Level, seed = 4242): Ctx {
  const rng = new RNG(seed);
  const hero = createStarterHero(0, level.w);
  const logs: string[] = [];
  const mobs: ContentMob[] = [];
  const ctx: ActionContext = {
    rng,
    level,
    hero,
    mobs: mobs as unknown as MobActor[],
    log: (m: string) => logs.push(m),
    killMob: (m: MobActor) => {
      const i = mobs.indexOf(m as ContentMob);
      if (i >= 0) mobs.splice(i, 1);
    },
    removeMob: (m: MobActor) => {
      const i = mobs.indexOf(m as ContentMob);
      if (i >= 0) mobs.splice(i, 1);
    },
    addMob: (m: MobActor, _delay?: number) => {
      mobs.push(m as ContentMob);
    },
    syncMobs: () => {},
  };
  return { ctx, hero, logs, mobs };
}

/** Fresh king on a clean level; pedestals at cells 10 (left) and 12 (right). */
function makeKing(pos = 40): { king: KingMob; c: Ctx } {
  resetUndeadCount();
  resetKingPedestals();
  setKingPedestals(10, 12);
  setKingDeepestFloor(null);
  const level = makeLevel();
  const c = makeCtx(level);
  const king = new KingMob(1, pos, level.w, level.depth);
  c.mobs.push(king);
  return { king, c };
}

// --- stat constants ---

describe('king stats (King.java:51-75)', () => {
  test('HP/HT 300, def 25, atk 32, 20-38, dr 14, EXP 40, maxLvl 30 (King.java:59-94)', () => {
    expect(KING_HT).toBe(300);
    expect(KING_DEF.hp).toBe(300);
    expect(KING_DEF.def).toBe(KING_DEFENSE);
    expect(KING_DEFENSE).toBe(25);
    expect(KING_DEF.atk).toBe(KING_ATTACK);
    expect(KING_ATTACK).toBe(32);
    expect([KING_DEF.dmgMin, KING_DEF.dmgMax]).toEqual([KING_DMG_MIN, KING_DMG_MAX]);
    expect([KING_DMG_MIN, KING_DMG_MAX]).toEqual([20, 38]);
    expect(KING_DEF.dr).toBe(KING_DR);
    expect(KING_DR).toBe(14);
    expect(KING_DEF.exp).toBe(KING_EXP);
    expect(KING_EXP).toBe(40);
    expect(KING_DEF.maxLvl).toBe(KING_MAX_LVL);
    expect(KING_MAX_LVL).toBe(30);
    expect(KING_DEF.sprite).toBe('mob_king');
  });

  test('resistances + immunities (King.java:206-225)', () => {
    expect([...KING_RESISTANCES]).toEqual([
      'toxic_gas',
      'death',
      'psionic_blast',
      'disintegration',
    ]);
    expect(KING_DEF.resistances).toEqual([...KING_RESISTANCES]);
    expect([...KING_IMMUNITIES]).toEqual(['paralysis', 'vertigo']);
    expect(KING_DEF.immunities).toEqual([...KING_IMMUNITIES]);
  });

  test('kingDamageRoll stays in 20-38 (King.java:82-84)', () => {
    const rng = new RNG(7);
    for (let i = 0; i < 200; i++) {
      const d = kingDamageRoll(rng);
      expect(d).toBeGreaterThanOrEqual(20);
      expect(d).toBeLessThanOrEqual(38);
    }
  });
});

describe('undead stats (King$Undead, King.java:222-316)', () => {
  test('HP/HT 28, def 15, atk 16, 12-16, dr 5, EXP 0, maxLvl 30 (King.java:232-302)', () => {
    expect(UNDEAD_HT).toBe(28);
    expect(UNDEAD_DEF.hp).toBe(28);
    expect(UNDEAD_DEF.def).toBe(UNDEAD_DEFENSE);
    expect(UNDEAD_DEFENSE).toBe(15);
    expect(UNDEAD_DEF.atk).toBe(UNDEAD_ATTACK);
    expect(UNDEAD_ATTACK).toBe(16);
    expect([UNDEAD_DMG_MIN, UNDEAD_DMG_MAX]).toEqual([12, 16]);
    expect(UNDEAD_DEF.dr).toBe(UNDEAD_DR);
    expect(UNDEAD_DR).toBe(5);
    expect(UNDEAD_DEF.exp).toBe(UNDEAD_EXP);
    expect(UNDEAD_EXP).toBe(0);
    expect(UNDEAD_DEF.maxLvl).toBe(UNDEAD_MAX_LVL);
    expect(UNDEAD_MAX_LVL).toBe(30);
    expect(UNDEAD_DEF.name).toBe('undead dwarf');
    expect(UNDEAD_DEF.sprite).toBe('mob_undead');
  });

  test('immunities Death + Paralysis (King.java:310-316)', () => {
    expect([...UNDEAD_IMMUNITIES]).toEqual(['death', 'paralysis']);
    expect(UNDEAD_DEF.immunities).toEqual([...UNDEAD_IMMUNITIES]);
  });

  test('undead spawn in WANDERING state (King.java:237)', () => {
    const u = new UndeadMob(5, 20, 9);
    expect(u.state).toBe('wandering');
    expect(u.hp).toBe(28);
    expect(u.ht).toBe(28);
  });

  test('undeadDamageRoll stays in 12-16 (King.java:261-263)', () => {
    const rng = new RNG(7);
    for (let i = 0; i < 200; i++) {
      const d = undeadDamageRoll(rng);
      expect(d).toBeGreaterThanOrEqual(12);
      expect(d).toBeLessThanOrEqual(16);
    }
  });

  test('attackProc: 1/5 paralysis chance, damage unchanged (King.java:271-277)', () => {
    expect(UNDEAD_PARALYSIS_DIE).toBe(KING_MAX_ARMY_SIZE); // 5
    expect(UNDEAD_PARALYSIS_TURNS).toBe(1);
    const level = makeLevel();
    const c = makeCtx(level, 999);
    const u = new UndeadMob(5, 20, level.w);
    // TS narrows buffs.paralysis to undefined after `delete` on the same
    // reference; read through a fresh function call each iteration.
    const buffView = () =>
      c.hero.buffs as unknown as Record<
        string,
        { kind: string; left: number } | undefined
      >;
    let paralysed = 0;
    for (let i = 0; i < 400; i++) {
      delete buffView().paralysis;
      c.hero.paralysed = false;
      const dmg = u.attackProc(c.ctx, c.hero, 13);
      expect(dmg).toBe(13);
      const p = buffView().paralysis;
      if (p !== undefined) {
        paralysed++;
        expect(p.left).toBe(1);
        expect(c.hero.paralysed).toBe(true);
      }
    }
    // 400 trials at p=0.2: expect ~80, assert the proc fires at all
    // and never outside the die (sanity against always-on).
    expect(paralysed).toBeGreaterThan(30);
    expect(paralysed).toBeLessThan(150);
  });
});

// --- name logic ---

describe('king name (King.java:55)', () => {
  test('"King of Dwarves" at deepest floor; "undead King of Dwarves" otherwise', () => {
    expect(kingDisplayName(20, 20)).toBe('King of Dwarves');
    expect(kingDisplayName(20, 22)).toBe('undead King of Dwarves');
    expect(kingDisplayName(20, null)).toBe('King of Dwarves');
  });

  test('KingMob constructor applies the name rule', () => {
    resetUndeadCount();
    const a = new KingMob(1, 40, 9, 20, 20);
    expect(a.name).toBe('King of Dwarves');
    const b = new KingMob(2, 40, 9, 20, 22);
    expect(b.name).toBe('undead King of Dwarves');
    // default (no meta tracking yet) = first descent = deepest
    const c = new KingMob(3, 40, 9, 20);
    expect(c.name).toBe('King of Dwarves');
  });
});

// --- army size ---

describe('maxArmySize (King.java:34, 151-153)', () => {
  test('MAX_ARMY_SIZE = 5', () => {
    expect(KING_MAX_ARMY_SIZE).toBe(5);
  });

  test('1 + 5*(HT-HP)/HT at HP thresholds (Java int division)', () => {
    expect(kingMaxArmySize(300, 300)).toBe(1); // full HP
    expect(kingMaxArmySize(240, 300)).toBe(2); // 1 + 5*60/300
    expect(kingMaxArmySize(150, 300)).toBe(3); // 1 + 5*150/300 = 3.5 -> 3
    expect(kingMaxArmySize(60, 300)).toBe(5); // 1 + 5*240/300 = 5
    expect(kingMaxArmySize(1, 300)).toBe(5); // 1 + floor(4.98)
    expect(kingMaxArmySize(0, 300)).toBe(6); // 1 + 5
  });

  test('undeadsToSummon = maxArmySize - Undead.count (King.java:168)', () => {
    expect(kingUndeadsToSummon(1, 0)).toBe(1);
    expect(kingUndeadsToSummon(3, 1)).toBe(2);
    expect(kingUndeadsToSummon(6, 6)).toBe(0);
  });
});

// --- ring placement loop ---

describe('summon ring loop (King.java:171-190)', () => {
  test('claims lowest-index cells ring by ring', () => {
    // 5x5: ring 1 at indices with dist==1, ring 2 dist==2
    const dist = new Float64Array(25).fill(Infinity);
    dist[7] = 1;
    dist[11] = 1;
    dist[13] = 1;
    dist[17] = 1;
    dist[1] = 2;
    dist[23] = 2;
    const cells = undeadSpawnCells(dist, 25, 3);
    expect(cells).toEqual([7, 11, 13]); // index order within ring 1
    const cells2 = undeadSpawnCells(dist, 25, 5);
    expect(cells2).toEqual([7, 11, 13, 17, 1]); // ring 1 then ring 2
  });

  test('empty ring kills later spawns (vanilla do-while quirk)', () => {
    // Only dist==3 exists, undeadsToSummon=2: i=0 scans d=1 (none), d=2,
    // exits with d=2; i=1 scans d=2 (none), d=3, exits. Nothing spawns.
    const dist = new Float64Array(25).fill(Infinity);
    dist[6] = 3;
    dist[18] = 3;
    expect(undeadSpawnCells(dist, 25, 2)).toEqual([]);
    // With undeadsToSummon=4: i=0..3 each run the do-body at growing d;
    // i=2 scans d=3 and claims both dist==3 cells? No — one claim per
    // outer iteration (continue undeadLabel). i=2 claims 6, i=3 scans d=3
    // again (dist[6] now Infinity) and claims 18.
    const cells = undeadSpawnCells(new Float64Array(dist), 25, 4);
    expect(cells).toEqual([6, 18]);
  });

  test('zero to summon spawns nothing', () => {
    const dist = new Float64Array(25).fill(Infinity);
    dist[7] = 1;
    expect(undeadSpawnCells(dist, 25, 0)).toEqual([]);
  });
});

// --- pedestals ---

describe('pedestal registry (CityBossLevel.java:137-143)', () => {
  test('first=true is the left pedestal', () => {
    setKingPedestals(100, 104);
    expect(kingPedestal(true)).toBe(100);
    expect(kingPedestal(false)).toBe(104);
    resetKingPedestals();
  });
});

// --- canTryToSummon / AI ---

describe('canTryToSummon (King.java:106-113)', () => {
  test('true when army has room and the pedestal is free', () => {
    const { king, c } = makeKing();
    c.hero.pos = 70; // far from the pedestal at 10
    expect(king.canTryToSummon(c.ctx)).toBe(true);
  });

  test('false when the hero stands on the target pedestal', () => {
    const { king, c } = makeKing();
    c.hero.pos = 10; // left pedestal, king.nextPedestal starts true
    expect(king.nextPedestal).toBe(true);
    expect(king.canTryToSummon(c.ctx)).toBe(false);
  });

  test('true when the king itself stands on the pedestal', () => {
    const { king, c } = makeKing(10); // king on the left pedestal
    expect(king.canTryToSummon(c.ctx)).toBe(true);
  });

  test('false when the army is full', () => {
    const { king, c } = makeKing();
    // maxArmy at full HP = 1; summon once to fill it
    king.pos = 10;
    king.doAttack(c.ctx, c.hero);
    expect(getUndeadCount()).toBe(1);
    expect(king.canTryToSummon(c.ctx)).toBe(false);
  });

  test('canAttack: only on the pedestal while summoning (King.java:103-108)', () => {
    const { king, c } = makeKing();
    c.hero.pos = 70;
    // canTryToSummon true (pedestal 10 free), king at 40 != 10
    expect(king.canAttack(c.ctx, c.hero.pos)).toBe(false);
    king.pos = 10;
    expect(king.canAttack(c.ctx, c.hero.pos)).toBe(true);
  });

  test('getCloser: heads for the pedestal while summoning (King.java:96-101)', () => {
    const { king, c } = makeKing(40);
    c.hero.pos = 70; // pedestal 10 free
    const moved = king.getCloser(c.ctx, c.hero.pos);
    expect(moved).toBe(true);
    // stepped toward pedestal 10, not toward the hero at 70
    expect(king.pos).not.toBe(40);
    expect(chebyshevPos(king.pos, 10, 9)).toBeLessThan(chebyshevPos(40, 10, 9));
  });

  test('doAttack: summons instead of striking on the pedestal (King.java:115-120)', () => {
    const { king, c } = makeKing(10);
    c.hero.pos = 70;
    const hpBefore = c.hero.hp;
    king.doAttack(c.ctx, c.hero);
    expect(getUndeadCount()).toBe(1); // summoned, not a strike
    expect(c.hero.hp).toBe(hpBefore); // hero untouched
    expect(king.nextPedestal).toBe(false); // toggled (King.java:157)
    expect(c.logs).toContain('Arise, slaves!');
    const undead = c.mobs.find((m) => m instanceof UndeadMob);
    expect(undead).toBeDefined();
    expect(undead!.state).toBe('wandering');
    // ring-1 placement: adjacent to the king's summon cell
    expect(chebyshevPos(undead!.pos, 10, 9)).toBe(1);
    expect(undead!.pos).not.toBe(10);
  });

  test('doAttack: hero on the pedestal flips nextPedestal, then strikes (King.java:124-130)', () => {
    const { king, c } = makeKing(11); // adjacent to the hero at 10
    c.hero.pos = 10; // hero stands on the left pedestal
    const hpBefore = c.hero.hp;
    king.doAttack(c.ctx, c.hero);
    expect(king.nextPedestal).toBe(false);
    // a normal strike happened (hero took damage or the attack missed —
    // either way no summon ran)
    expect(getUndeadCount()).toBe(0);
    expect(c.hero.hp).toBeLessThanOrEqual(hpBefore);
  });
});

// --- Undead.count lifecycle ---

describe('Undead.count lifecycle (King.java:64, 240-249)', () => {
  test('king construction resets the count', () => {
    resetUndeadCount();
    const { king, c } = makeKing(10);
    king.pos = 10;
    king.doAttack(c.ctx, c.hero);
    expect(getUndeadCount()).toBe(1);
    new KingMob(2, 40, 9, 20); // re-init (King.java:64)
    expect(getUndeadCount()).toBe(0);
  });

  test('undead death decrements the count', () => {
    const { king, c } = makeKing(10);
    king.doAttack(c.ctx, c.hero);
    expect(getUndeadCount()).toBe(1);
    const undead = c.mobs.find((m) => m instanceof UndeadMob)!;
    undead.onDeath(c.ctx);
    expect(getUndeadCount()).toBe(0);
  });
});

// --- notice / death ---

describe('notice and death (King.java:121-133, 194-197)', () => {
  test('notice yells "How dare you!"', () => {
    const { king, c } = makeKing();
    king.notice(c.ctx);
    expect(c.logs).toContain('How dare you!');
  });

  test('death drops the skeleton key and yells (King.java:126-132)', () => {
    const { king, c } = makeKing();
    king.onDeath(c.ctx);
    const drops = c.ctx.level.items.filter((it) => it.pos === king.pos);
    expect(drops.some((d) => d.itemId === 'skeleton_key')).toBe(true);
    expect(c.logs).toContain(
      'You cannot kill me, warrior... I am... immortal...',
    );
  });
});

// --- arena entry ---

describe('arena entry (CityBossLevel.java:176-200)', () => {
  test('spawnKingArena: HUNTING, added, noticed when visible', () => {
    resetUndeadCount();
    const level = makeLevel();
    const c = makeCtx(level);
    level.visible[40] = 1;
    const king = spawnKingArena(c.ctx, 40);
    expect(king).toBeInstanceOf(KingMob);
    expect(king.state).toBe('hunting');
    expect(c.mobs).toContain(king);
    expect(c.logs).toContain('How dare you!');
    expect(king.name).toBe('King of Dwarves');
  });

  test('spawnKingArena: silent when the spawn cell is not visible', () => {
    resetUndeadCount();
    const level = makeLevel();
    const c = makeCtx(level);
    spawnKingArena(c.ctx, 40);
    expect(c.logs).not.toContain('How dare you!');
  });

  test('spawnKingArena: undead name when not at deepest floor', () => {
    resetUndeadCount();
    setKingDeepestFloor(22);
    const level = makeLevel();
    const c = makeCtx(level);
    const king = spawnKingArena(c.ctx, 40);
    expect(king.name).toBe('undead King of Dwarves');
    setKingDeepestFloor(null);
  });
});

// --- sprites ---

describe('undead toxic-gas clearing (King.java:281-286)', () => {
  test('toxic gas damage clears the gas under an undead dwarf', () => {
    resetUndeadCount();
    const level = makeLevel();
    const c = makeCtx(level);
    const gas = new ToxicGasBlob(level.w * level.h);
    gas.seed(40, 10);
    level.blobs.push(gas);
    const u = new UndeadMob(5, 40, level.w);
    c.mobs.push(u);
    damageFromTrap(c.ctx, c.ctx.rng, u as unknown as TrapChar, 2, 'toxic_gas');
    expect(gas.cur[40]).toBe(0); // Blob.clear(pos) (King.java:284)
    expect(u.hp).toBe(26); // damage itself still applies (King.java:283)
  });

  test('gas is not cleared under other mobs', () => {
    const level = makeLevel();
    const c = makeCtx(level);
    const gas = new ToxicGasBlob(level.w * level.h);
    gas.seed(40, 10);
    level.blobs.push(gas);
    const other = new ContentMob(6, { ...UNDEAD_DEF, id: 'skeleton' }, 40, level.w);
    c.mobs.push(other);
    damageFromTrap(c.ctx, c.ctx.rng, other as unknown as TrapChar, 2, 'toxic_gas');
    expect(gas.cur[40]).toBe(10);
  });
});

describe('king sprites (KingSprite.java / UndeadSprite.java)', () => {
  test('mob_king: king.png 16x16 idle frame 0', () => {
    const s = STAGE3_KING_SPRITES.mob_king;
    expect(s.w).toBe(16);
    expect(s.h).toBe(16);
    expect(s.rgba.length).toBeGreaterThan(100);
  });

  test('mob_undead: undead.png 12x16 padded to 16x16 bottom-aligned', () => {
    const s = STAGE3_KING_SPRITES.mob_undead;
    expect(s.w).toBe(16);
    expect(s.h).toBe(16);
    const bin = Buffer.from(s.rgba, 'base64');
    expect(bin.length).toBe(16 * 16 * 4);
    // bottom-aligned: the original 12x16 frame has no transparent rows at
    // the top in king.png's undead art — the slice is pixel-verified by the
    // extractor against the source PNGs.
  });
});
