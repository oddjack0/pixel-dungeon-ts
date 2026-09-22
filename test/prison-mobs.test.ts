/**
 * Stage 1 tests: Prison mobs (Shaman/Bat/Brute), the Tengu boss, rare
 * mutations (Albino/Bandit/Shielded), Bestiary tables, blindness, and
 * original sprite slices. Every stat cites its Java source.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain } from '../src/core/grid.js';
import { Level } from '../src/dungeon/level.js';
import type {
  ActionContext,
  MobActor,
} from '../src/engine/seams.js';
import { ORIGINAL_SPRITES } from '../src/assets/original_sprites.js';
import {
  MOB_DEFS,
  buildMob,
  chebyshevPos,
  killMob,
  rangedCanAttack,
  strikeHeroVsMob,
  ThiefMob,
  type ContentMob,
} from '../src/content/mobs.js';
import {
  ContentHero,
  createStarterHero,
} from '../src/content/hero.js';
import {
  mutable,
  pickMobId,
  resolveMobSpawns,
} from '../src/content/spawns.js';
import { bestiaryMobId } from '../src/mechanics/traps.js';
import { MOB_EXP } from '../src/mechanics/exp.js';
import {
  TENGU_ATTACK,
  TENGU_DEFENSE,
  TENGU_DR,
  TENGU_EXP,
  TENGU_HT,
  TENGU_JUMP_DELAY,
  TENGU_MAX_LVL,
  tenguDamageRoll,
  tenguShouldJump,
} from '../src/mechanics/tengu.js';
import { contentMechanics } from '../src/content/hooks.js';
import '../src/content/tengu-boss.js'; // registers the Tengu constructor
import { TenguMob, TENGU_DEF } from '../src/content/tengu-boss.js';

// --- helpers ---

function makeLevel(w = 12, h = 12, depth = 6): Level {
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
  mobs: ContentMob[];
}

function makeCtx(level: Level, seed = 4242): Ctx {
  const rng = new RNG(seed);
  const hero = createStarterHero(5 * level.w + 5, level.w);
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

/** Place a mob adjacent-ish on the ctx and return it. */
function addMob(c: Ctx, mobId: string, x: number, y: number): ContentMob {
  const mob = buildMob(mobId, c.mobs.length + 1, y * c.ctx.level.w + x, c.ctx.level.w);
  c.mobs.push(mob);
  return mob;
}

// --- stat tables ---

describe('prison mob stats (Java ground truth)', () => {
  test('shaman: HP/HT 18, def 8, atk 11, melee 2-6, dr 4, EXP 6, maxLvl 14 (Shaman.java:44-71)', () => {
    const d = MOB_DEFS.shaman!;
    expect(d.hp).toBe(18);
    expect(d.atk).toBe(11);
    expect(d.def).toBe(8);
    expect([d.dmgMin, d.dmgMax]).toEqual([2, 6]);
    expect(d.dr).toBe(4);
    expect(d.exp).toBe(6);
    expect(d.maxLvl).toBe(14);
    expect(d.name).toBe('gnoll shaman');
    expect(d.sprite).toBe('mob_shaman');
    expect(d.resistances).toContain('lightning'); // Shaman.java:135-143
  });

  test('bat: HP/HT 30, def 15, atk 16, 6-12, dr 4, speed 2, flying, EXP 7, maxLvl 15 (Bat.java:31-45)', () => {
    const d = MOB_DEFS.bat!;
    expect(d.hp).toBe(30);
    expect(d.atk).toBe(16);
    expect(d.def).toBe(15);
    expect([d.dmgMin, d.dmgMax]).toEqual([6, 12]);
    expect(d.dr).toBe(4);
    expect(d.speed).toBe(2);
    expect(d.flying).toBe(true);
    expect(d.exp).toBe(7);
    expect(d.maxLvl).toBe(15);
    expect(d.name).toBe('vampire bat');
    expect(d.resistances).toContain('leech'); // Bat.java:88-96
  });

  test('brute: HP/HT 40, def 15, atk 20, 8-18, dr 8, EXP 8, maxLvl 15, terror-immune (Brute.java)', () => {
    const d = MOB_DEFS.brute!;
    expect(d.hp).toBe(40);
    expect(d.atk).toBe(20);
    expect(d.def).toBe(15);
    expect([d.dmgMin, d.dmgMax]).toEqual([8, 18]);
    expect(d.dr).toBe(8);
    expect(d.exp).toBe(8);
    expect(d.maxLvl).toBe(15);
    expect(d.name).toBe('gnoll brute');
    expect(d.immunities).toContain('terror'); // Brute.java:196-204
  });

  test('tengu: HP/HT 120, def 20, atk 20, 8-15, dr 5, EXP 20, maxLvl 30 (Tengu.java:51-75)', () => {
    expect(TENGU_HT).toBe(120);
    expect(TENGU_DEFENSE).toBe(20);
    expect(TENGU_ATTACK).toBe(20);
    expect(TENGU_DR).toBe(5);
    expect(TENGU_EXP).toBe(20);
    expect(TENGU_MAX_LVL).toBe(30);
    const d = TENGU_DEF;
    expect(d.hp).toBe(120);
    expect(d.exp).toBe(20);
    expect(d.maxLvl).toBe(30);
    expect(d.name).toBe('Tengu');
    expect(d.sprite).toBe('mob_tengu');
    expect(d.resistances).toEqual(
      expect.arrayContaining(['toxic_gas', 'poison', 'death', 'psionic_blast']),
    ); // Tengu.java:183-194
  });

  test('mutations: albino HP 15 (Albino.java:29), bandit = thief stats (Bandit.java), shielded def 20/dr 10 (Shielded.java:25-46)', () => {
    const albino = MOB_DEFS.albino!;
    expect(albino.hp).toBe(15);
    expect(albino.name).toBe('albino rat');
    expect(albino.exp).toBe(1); // Rat EXP (Albino overrides HP only)
    expect(albino.maxLvl).toBe(5);
    const bandit = MOB_DEFS.bandit!;
    expect(bandit.hp).toBe(MOB_DEFS.thief!.hp);
    expect(bandit.atk).toBe(MOB_DEFS.thief!.atk);
    expect(bandit.exp).toBe(5);
    expect(bandit.maxLvl).toBe(10);
    expect(bandit.name).toBe('crazy bandit');
    const shielded = MOB_DEFS.shielded!;
    expect(shielded.def).toBe(20);
    expect(shielded.dr).toBe(10);
    expect(shielded.hp).toBe(40); // Brute HP otherwise
    expect(shielded.exp).toBe(8);
    expect(shielded.maxLvl).toBe(15);
    expect(shielded.name).toBe('shielded brute');
  });

  test('MOB_EXP entries single-source the defs', () => {
    for (const id of ['shaman', 'bat', 'brute', 'albino', 'bandit', 'shielded'] as const) {
      expect(MOB_EXP[id]!.exp).toBe(MOB_DEFS[id]!.exp);
      expect(MOB_EXP[id]!.maxLvl).toBe(MOB_DEFS[id]!.maxLvl);
    }
    expect(MOB_EXP.tengu).toEqual({ exp: 20, maxLvl: 30 });
  });
});

describe('original sprite slices (Stage 1)', () => {
  test('all seven mob sprites exist as 16x16 padded slices (extract_original_sprites.ts)', () => {
    // Convention: idle frame 0 per the *Sprite.java TextureFilm sizes, padded
    // bottom-aligned to 16x16 where the original frame is smaller.
    for (const key of [
      'mob_shaman', // ShamanSprite: TextureFilm 12x15
      'mob_bat', // BatSprite: TextureFilm 15x15
      'mob_brute', // BruteSprite: TextureFilm 12x16
      'mob_tengu', // TenguSprite: TextureFilm 14x16
      'mob_albino', // AlbinoSprite: rat.png row 1 (frame 16)
      'mob_bandit', // BanditSprite: thief.png row 1 (frame 21)
      'mob_shielded', // ShieldedSprite: brute.png row 1 (frame 21)
    ]) {
      const s = ORIGINAL_SPRITES[key];
      expect(s, key).toBeDefined();
      expect(s!.w).toBe(16);
      expect(s!.h).toBe(16);
      // rgba is base64-encoded pixel bytes (extract_original_sprites.ts).
      expect(Buffer.from(s!.rgba, 'base64').length).toBe(16 * 16 * 4);
    }
  });
});

// --- Bestiary ---

describe('Bestiary tables (Bestiary.java:90-110)', () => {
  test('pickMobId draws only from the depth 6-9 tables', () => {
    const sets: Record<number, string[]> = {
      6: ['skeleton', 'thief', 'swarm', 'shaman'],
      7: ['skeleton', 'shaman', 'thief', 'swarm'],
      8: ['skeleton', 'shaman', 'gnoll', 'thief', 'swarm', 'bat'],
      9: ['skeleton', 'shaman', 'thief', 'swarm', 'bat', 'brute'],
    };
    for (const [depth, ids] of Object.entries(sets)) {
      const rng = new RNG(Number(depth) * 77 + 3);
      for (let i = 0; i < 60; i++) {
        expect(ids).toContain(pickMobId(rng, Number(depth)));
      }
    }
  });

  test('boss spawns: depth 5 -> goo, depth 10 -> tengu', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const spawns5 = resolveMobSpawns(c.ctx.rng, 5, [{ pos: 10, kind: 'boss' }]);
    expect(spawns5[0]!.mobId).toBe('goo');
    const spawns10 = resolveMobSpawns(c.ctx.rng, 10, [{ pos: 10, kind: 'boss' }]);
    expect(spawns10[0]!.mobId).toBe('tengu');
  });

  test('mutable: 1/30 rare variants (Bestiary.java:37-53)', () => {
    const trigger = { int: () => 0 } as unknown as Parameters<typeof mutable>[0];
    expect(mutable(trigger, 'rat')).toBe('albino');
    expect(mutable(trigger, 'thief')).toBe('bandit');
    expect(mutable(trigger, 'brute')).toBe('shielded');
    expect(mutable(trigger, 'skeleton')).toBe('skeleton'); // no mapping
    const noTrigger = { int: () => 1 } as unknown as Parameters<typeof mutable>[0];
    expect(mutable(noTrigger, 'rat')).toBe('rat');
    expect(mutable(noTrigger, 'brute')).toBe('brute');
  });

  test('summoning trap table: depths 6-9 (Bestiary.mob, SummoningTrap.java:80)', () => {
    const sets: Record<number, string[]> = {
      6: ['skeleton', 'thief', 'swarm', 'shaman'],
      7: ['skeleton', 'shaman', 'thief', 'swarm'],
      8: ['skeleton', 'shaman', 'gnoll', 'thief', 'swarm', 'bat'],
      9: ['skeleton', 'shaman', 'thief', 'swarm', 'bat', 'brute'],
    };
    for (const [depth, ids] of Object.entries(sets)) {
      const rng = new RNG(Number(depth) * 131 + 7);
      for (let i = 0; i < 40; i++) {
        const id = bestiaryMobId(rng, Number(depth));
        expect(id).not.toBeNull();
        expect(ids).toContain(id!);
      }
    }
    // Boss depths summon nothing.
    expect(bestiaryMobId(new RNG(1), 5)).toBeNull();
    expect(bestiaryMobId(new RNG(1), 10)).toBeNull();
  });
});

// --- Shaman ---

describe('shaman', () => {
  test('canAttack: ballistica through open room, blocked by walls (Shaman.java:74-76)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    // Wall column at x=6.
    for (let y = 0; y < 12; y++) lvl.set(6, y, Terrain.WALL);
    const shaman = addMob(c, 'shaman', 2, 5);
    // Hero at (5,5): open line.
    c.hero.pos = 5 * lvl.w + 5;
    expect(rangedCanAttack(c.ctx, shaman, c.hero.pos)).toBe(true);
    // Hero at (9,5): wall column between.
    c.hero.pos = 5 * lvl.w + 9;
    expect(rangedCanAttack(c.ctx, shaman, c.hero.pos)).toBe(false);
    // Adjacent is always attackable.
    c.hero.pos = 5 * lvl.w + 3;
    expect(rangedCanAttack(c.ctx, shaman, c.hero.pos)).toBe(true);
  });

  test('ranged zap costs 2 turns; adjacent uses melee (Shaman.java:79-92)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const shaman = addMob(c, 'shaman', 2, 5);
    // Ranged: hero 4 cells away in the open.
    c.hero.pos = 5 * lvl.w + 6;
    const hpBefore = c.hero.hp;
    const cost = (shaman as unknown as { doAttack(ctx: ActionContext, h: ContentHero): number })
      .doAttack(c.ctx, c.hero);
    expect(cost).toBe(2); // TIME_TO_ZAP (Shaman.java:40, 92)
    // Either a hit (hp dropped) or a logged miss — never silent.
    const hit = c.hero.hp < hpBefore;
    const logged = c.logs.some((l) => l.includes('lightning'));
    expect(hit || logged).toBe(true);
    // Adjacent: plain melee die 2-6 (Shaman.damageRoll, Shaman.java:58-61).
    const lvl2 = makeLevel();
    const c2 = makeCtx(lvl2, 999);
    const shaman2 = addMob(c2, 'shaman', 2, 5);
    c2.hero.pos = 5 * lvl2.w + 3;
    let minSeen = Infinity;
    let maxSeen = -Infinity;
    for (let i = 0; i < 200; i++) {
      c2.hero.hp = c2.hero.ht;
      const hp0 = c2.hero.hp;
      (shaman2 as unknown as { doAttack(ctx: ActionContext, h: ContentHero): number })
        .doAttack(c2.ctx, c2.hero);
      const dealt = hp0 - c2.hero.hp;
      if (dealt > 0) {
        minSeen = Math.min(minSeen, dealt);
        maxSeen = Math.max(maxSeen, dealt);
      }
    }
    // Post-dr melee damage stays within the 2-6 die (hero has no armor in M1).
    expect(maxSeen).toBeLessThanOrEqual(6);
  });
});

// --- Bat ---

describe('bat', () => {
  test('attackProc heals min(damage, HT-HP) (Bat.java:69-79)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const bat = addMob(c, 'bat', 2, 5);
    bat.hp = 20;
    const dealt = (bat as unknown as { attackProc(ctx: ActionContext, h: ContentHero, d: number): number })
      .attackProc(c.ctx, c.hero, 10);
    expect(dealt).toBe(10); // damage passes through unchanged
    expect(bat.hp).toBe(30); // min(10, 30-20)
    bat.hp = 28;
    (bat as unknown as { attackProc(ctx: ActionContext, h: ContentHero, d: number): number })
      .attackProc(c.ctx, c.hero, 10);
    expect(bat.hp).toBe(30); // capped at HT
  });

  test('flying: speed 2 in the def', () => {
    expect(MOB_DEFS.bat!.speed).toBe(2);
    expect(MOB_DEFS.bat!.flying).toBe(true);
  });
});

// --- Brute ---

describe('brute', () => {
  test('enrages strictly below HT/4 (Brute.java:173-184)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    lvl.visible[addMob(c, 'brute', 2, 5).pos] = 1;
    const brute = c.mobs[0]!;
    // HT 40 -> threshold 10; at exactly 10 HP no enrage.
    brute.hp = 10;
    (brute as unknown as { onDamaged(ctx: ActionContext): void }).onDamaged(c.ctx);
    expect((brute as unknown as { enraged: boolean }).enraged).toBe(false);
    brute.hp = 9;
    (brute as unknown as { onDamaged(ctx: ActionContext): void }).onDamaged(c.ctx);
    expect((brute as unknown as { enraged: boolean }).enraged).toBe(true);
    expect(c.logs.some((l) => l.includes('becomes enraged!'))).toBe(true); // TXT_ENRAGED
  });

  test('enraged die is 10-40, calm die is 8-18 (Brute.java:156-160)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const brute = addMob(c, 'brute', 2, 5) as unknown as {
      enraged: boolean;
      mobDamageRoll(rng: RNG): number;
    };
    const rng = new RNG(7);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 300; i++) {
      const d = brute.mobDamageRoll(rng);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    expect(lo).toBeGreaterThanOrEqual(8);
    expect(hi).toBeLessThanOrEqual(18);
    brute.enraged = true;
    lo = Infinity;
    hi = -Infinity;
    for (let i = 0; i < 500; i++) {
      const d = brute.mobDamageRoll(rng);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    expect(lo).toBeGreaterThanOrEqual(10);
    expect(hi).toBeLessThanOrEqual(40);
  });

  test('enrage via real damage: strikeHeroVsMob below threshold flips the die', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const brute = addMob(c, 'brute', 2, 5);
    brute.hp = 12;
    // Hit for 3+ to drop below 10 HP.
    strikeHeroVsMob(c.ctx, c.hero, brute, 100, () => 12);
    expect((brute as unknown as { enraged: boolean }).enraged).toBe(true);
  });
});

// --- Mutations ---

describe('rare mutations', () => {
  test('albino: 1/2 attackProc applies Bleeding at damage dealt (Albino.java:52-60)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const albino = addMob(c, 'albino', 2, 5);
    const proc = (albino as unknown as {
      attackProc(ctx: ActionContext, h: ContentHero, d: number): number;
    }).attackProc.bind(albino);
    // Force the 1/2 roll both ways via a stubbed rng.
    const yesCtx = { ...c.ctx, rng: { int: () => 0 } as unknown as RNG };
    proc(yesCtx, c.hero, 7);
    expect(c.hero.buffs.bleeding?.level).toBe(7);
    const noCtx = { ...c.ctx, rng: { int: () => 1 } as unknown as RNG };
    delete c.hero.buffs.bleeding;
    proc(noCtx, c.hero, 7);
    expect(c.hero.buffs.bleeding).toBeUndefined();
  });

  test('bandit: steal + Blindness 5-11 (Bandit.java:39-49)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const bandit = addMob(c, 'bandit', 2, 5);
    expect(bandit).toBeInstanceOf(ThiefMob);
    // Give the hero something to steal.
    c.hero.inventory.push({
      id: 'dart',
      kind: 'weapon' as never,
      qty: 3,
    } as never);
    (bandit as unknown as { doAttack(ctx: ActionContext, h: ContentHero): number })
      .doAttack(c.ctx, c.hero);
    const blindness = c.hero.buffs.blindness;
    expect(blindness).toBeDefined();
    expect(blindness!.left).toBeGreaterThanOrEqual(5);
    expect(blindness!.left).toBeLessThanOrEqual(11); // Random.Int(5, 12)
    expect(bandit.state).toBe('fleeing'); // Thief escape after steal
  });

  test('shielded: blocks (Shielded.java defense verb) and keeps brute gold loot', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    const shielded = addMob(c, 'shielded', 2, 5);
    expect(shielded.defenseVerb()).toBe('blocked'); // Shielded.java:38-40
    // Inherits Brute's loot (Shielded has no override): Gold @ 0.5
    // (Brute.java:144-145). Statistical: 30 kills, P(no gold) ~= 1e-9.
    let goldDrops = 0;
    for (let i = 0; i < 30; i++) {
      const cc = makeCtx(makeLevel(), 5000 + i);
      const s = addMob(cc, 'shielded', 2, 5);
      s.hp = 0;
      killMob(cc.ctx, s, {});
      if (cc.ctx.level.items.some((it) => it.itemId.startsWith('gold:'))) goldDrops++;
    }
    expect(goldDrops).toBeGreaterThan(0);
    expect(shielded.def.immunities).toContain('terror');
  });

  test('defense verbs: bat "evaded" (Bat.java:64-66), default "dodged" (Char.java:227-229)', () => {
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    expect(addMob(c, 'bat', 2, 5).defenseVerb()).toBe('evaded');
    expect(addMob(c, 'brute', 3, 5).defenseVerb()).toBe('dodged');
    // Vanilla miss text: "%s %s your attack" (Char.java:69).
    const bat = c.mobs[0]!;
    bat.enemySeen = true;
    const acc0 = 0;
    strikeHeroVsMob(c.ctx, c.hero, bat, acc0, () => 5);
    expect(c.logs.some((l) => l.includes('evaded your attack'))).toBe(true);
  });
});

// --- Tengu ---

describe('tengu boss', () => {
  function tenguCtx(depth = 10, seed = 31337): Ctx & { tengu: TenguMob } {
    const lvl = makeLevel(9, 9, depth);
    lvl.visible.fill(1); // Tengu stands where the hero can see (Tengu.java:92)
    const c = makeCtx(lvl, seed);
    const tengu = buildMob('tengu', 1, 4 * lvl.w + 4, lvl.w) as TenguMob;
    c.mobs.push(tengu);
    return { ...c, tengu };
  }

  test('constructor registration: buildMob("tengu") is a TenguMob with jump counter 5', () => {
    const { tengu } = tenguCtx();
    expect(tengu).toBeInstanceOf(TenguMob);
    expect(tengu.timeToJump).toBe(TENGU_JUMP_DELAY); // Tengu.timeToJump = 5 (Tengu.java:50)
    expect(tengu.hp).toBe(120);
  });

  test('tenguShouldJump: counter ticks down, jumps at 0, resets to 5 (Tengu.java:97-113)', () => {
    expect(tenguShouldJump(5, true)).toEqual({ jump: false, nextTimeToJump: 4 });
    expect(tenguShouldJump(2, true)).toEqual({ jump: false, nextTimeToJump: 1 });
    expect(tenguShouldJump(1, true)).toEqual({ jump: true, nextTimeToJump: 5 });
    expect(tenguShouldJump(0, true)).toEqual({ jump: true, nextTimeToJump: 5 });
    expect(tenguShouldJump(1, false)).toEqual({ jump: false, nextTimeToJump: 0 });
  });

  test('damage die 8-15 (Tengu.damageRoll, Tengu.java:161-164)', () => {
    const rng = new RNG(99);
    for (let i = 0; i < 500; i++) {
      const d = tenguDamageRoll(rng);
      expect(d).toBeGreaterThanOrEqual(8);
      expect(d).toBeLessThanOrEqual(15);
    }
  });

  test('doAttack jumps instead of attacking when the counter fires (Tengu.java:115-136)', () => {
    const c = tenguCtx();
    const { tengu, ctx } = c;
    // Hero adjacent so a normal attack would land.
    c.hero.pos = tengu.pos + 1;
    tengu.timeToJump = 1;
    tengu.enemySeen = true;
    const hpBefore = c.hero.hp;
    const cost = tengu.doAttack(ctx, c.hero);
    expect(cost).toBe(1); // jump costs a move (Tengu.java:135)
    expect(c.hero.hp).toBe(hpBefore); // no attack happened
    expect(tengu.timeToJump).toBe(5); // counter reset
  });

  test('jump arms up to 4 poison traps on visible inactive traps (Tengu.java:138-147)', () => {
    const c = tenguCtx();
    const { tengu, ctx, hero } = c;
    const lvl = ctx.level;
    // Every passable cell holds an inactive trap; the hero stays far away so
    // the destination constraint (not adjacent to enemy) is satisfiable.
    for (let y = 0; y < lvl.h; y++) {
      for (let x = 0; x < lvl.w; x++) lvl.set(x, y, Terrain.TRAP_INACTIVE);
    }
    lvl.visible.fill(1); // hero sees the whole test room
    hero.pos = 0; // corner
    // Trigger the jump through the pursuit path (getCloser jumps when the
    // enemy is seen — Tengu.java:92-101); doAttack's jump needs adjacency.
    tengu.enemySeen = true;
    tengu.getCloser(ctx, hero.pos);
    let poison = 0;
    for (let y = 0; y < lvl.h; y++) {
      for (let x = 0; x < lvl.w; x++) {
        if (lvl.get(x, y) === Terrain.TRAP_POISON) poison++;
      }
    }
    expect(poison).toBeGreaterThanOrEqual(1);
    expect(poison).toBeLessThanOrEqual(4);
    // Destination is visible, passable, and unoccupied.
    expect(lvl.visible[tengu.pos]).toBe(1);
    expect(lvl.isPassable(tengu.x, tengu.y)).toBe(true);
    expect(chebyshevPos(tengu.pos, hero.pos, lvl.w)).toBeGreaterThan(1);
    expect(tengu.timeToJump).toBe(5);
  });

  test('getCloser jumps while pursuing a seen enemy (Tengu.java:92-95)', () => {
    const c = tenguCtx();
    const { tengu, ctx, hero } = c;
    const from = tengu.pos;
    tengu.enemySeen = true;
    tengu.target = hero.pos;
    const moved = tengu.getCloser(ctx, hero.pos);
    expect(moved).toBe(true);
    expect(tengu.pos).not.toBe(from);
    expect(tengu.timeToJump).toBe(5);
  });

  test('death drops the skeleton key and logs the free-at-last line (Tengu.die, Tengu.java:166-177)', () => {
    const c = tenguCtx();
    const { tengu, ctx } = c;
    const before = c.logs.length;
    tengu.onDeath(ctx);
    expect(
      ctx.level.items.some((it) => it.itemId === 'skeleton_key' && it.pos === tengu.pos),
    ).toBe(true);
    // No tome_of_mastery in this build's catalog: skipped, never invented.
    expect(ctx.level.items.some((it) => it.itemId === 'tome_of_mastery')).toBe(false);
    expect(c.logs.slice(before).some((l) => l.includes('Free at last...'))).toBe(true);
  });

  test('save/revive round-trips timeToJump', () => {
    const c = tenguCtx();
    const { tengu } = c;
    tengu.timeToJump = 2;
    const data = contentMechanics.saveMob(tengu);
    const revived = contentMechanics.reviveMob(new RNG(1), data) as TenguMob;
    expect(revived).toBeInstanceOf(TenguMob);
    expect(revived.timeToJump).toBe(2);
  });
});

// --- save/restore: brute enraged ---

describe('save/restore', () => {
  test('brute enraged flag survives a save round-trip', () => {
    const c = makeCtx(makeLevel());
    const brute = addMob(c, 'brute', 2, 5);
    (brute as unknown as { enraged: boolean }).enraged = true;
    const data = contentMechanics.saveMob(brute);
    const revived = contentMechanics.reviveMob(new RNG(1), data);
    expect((revived as unknown as { enraged: boolean }).enraged).toBe(true);
  });
});

// --- blindness ---

describe('blindness (Blindness.java)', () => {
  test('tickBuffs counts blindness down and expires it', async () => {
    const { tickBuffs } = await import('../src/content/mobs.js');
    const c = makeCtx(makeLevel());
    c.hero.buffs.blindness = { kind: 'blindness', left: 2 };
    tickBuffs(c.ctx.rng, c.ctx.level, c.hero, c.ctx.log);
    expect(c.hero.buffs.blindness?.left).toBe(1);
    tickBuffs(c.ctx.rng, c.ctx.level, c.hero, c.ctx.log);
    expect(c.hero.buffs.blindness).toBeUndefined();
  });

  test('updateHeroFov: blinded hero sees nothing, sighted hero sees the room', async () => {
    const mod = await import('../src/engine/loop.js');
    const Game = mod.Game;
    const lvl = makeLevel();
    const c = makeCtx(lvl);
    // Drive the engine's private FOV refresh without a full boot.
    const game = Object.create(Game.prototype) as {
      updateHeroFov(): void;
    };
    (game as unknown as { hero: ContentHero }).hero = c.hero;
    (game as unknown as { level: Level }).level = lvl;
    game.updateHeroFov();
    const sighted = lvl.visible.reduce((a, b) => a + b, 0);
    expect(sighted).toBeGreaterThan(0);
    // Blindness blackout (Level.updateFieldOfView, Level.java:793).
    c.hero.buffs.blindness = { kind: 'blindness', left: 5 };
    game.updateHeroFov();
    expect(lvl.visible.reduce((a, b) => a + b, 0)).toBe(0);
    // Expiry restores sight.
    delete c.hero.buffs.blindness;
    game.updateHeroFov();
    expect(lvl.visible.reduce((a, b) => a + b, 0)).toBe(sighted);
  });
});

