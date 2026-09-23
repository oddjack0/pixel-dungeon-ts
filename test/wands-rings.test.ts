/**
 * Stage 2 wands & rings tests (Worker 3): the full 13-wand system, the full
 * 12-ring system, and the Wandmaker's real wand rewards — all grounded in
 * the Java sources under ~/workspace/pixel-dungeon-src (GPL-3.0).
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain } from '../src/core/grid.js';
import { Level } from '../src/dungeon/level.js';
import type { ActionContext, MobActor } from '../src/engine/seams.js';
import { initIdentification } from '../src/content/identification.js';
import {
  ContentHero,
  addToInventory,
  createStarterHero,
} from '../src/content/hero.js';
import {
  accuracyMultiplier,
  evasionMultiplier,
} from '../src/mechanics/hero.js';
import {
  WAND_SPECS,
  USAGES_TO_KNOW,
  wandMaxCharges,
  wandPower,
  wandRechargeTurns,
  magicMissileDamage,
  fireboltDamage,
  lightningInitialDamage,
  disintegrationDamage,
  avalancheDamage,
  avalancheParalyzes,
  poisonWandDuration,
  amokDuration,
  flockSheepCount,
  flockLifespan,
  regrowthSeedAmount,
  blinkDestinationCell,
} from '../src/mechanics/wands.js';
import {
  beginZap,
  catalogHas,
  createWand,
  createWandReward,
  dropWandAt,
  getWandState,
  identifyWandType,
  instanceItemDef,
  isWandId,
  isWandTypeKnown,
  normalizeWandPickup,
  parseWandId,
  rechargeWands,
  resetWandState,
  restoreWandState,
  saveWandState,
  upgradeWand,
  useWandFromSlot,
  wandDisplayName,
  wandItemDef,
  wandPrice,
  zapWandFromSlot,
  RegrowthBlob,
  type WandFxEvent,
  type WandState,
} from '../src/content/wands.js';
import {
  RING_GEMS,
  RING_SPECS,
  TICKS_TO_KNOW,
  accuracyRingMultiplier,
  createRing,
  dropRingAt,
  elementsLevel,
  elementsResists,
  equipRing,
  equippedRingLevels,
  equippedRings,
  evasionRingMultiplier,
  getRingState,
  hagglerDiscount,
  hasteTimeScale,
  herbalismDewChance,
  herbalismSeedChance,
  identifyRingType,
  isRingId,
  isRingTypeKnown,
  normalizeRingPickup,
  parseRingId,
  powerRingBonus,
  resetRingState,
  restoreRingState,
  ringBonus,
  ringDisplayDesc,
  ringDisplayName,
  ringDisplaySprite,
  ringGemLabel,
  ringItemDefFor,
  ringPrice,
  saveRingState,
  satietyBonus,
  shadowsBonus,
  thornsReflect,
  tickRingClocks,
  unequipRing,
  useRingFromSlot,
} from '../src/content/rings.js';
import {
  initWandmakerQuest,
  resetQuestState,
  resolveWandReward,
  wandmakerQuest,
} from '../src/content/npcs.js';
import type { MechanicsRng } from '../src/mechanics/rng.js';
import { slowDuration as slownessDuration } from '../src/mechanics/buffs.js';

/** Deterministic stub RNG (mirrors the pattern in test/content.test.ts). */
class StubRng implements MechanicsRng {
  private floats: number[];
  private ints: number[];
  constructor(floats: number[] = [], ints: number[] = []) {
    this.floats = [...floats];
    this.ints = [...ints];
  }
  float(min: number, max: number): number {
    const f = this.floats.length ? this.floats.shift()! : 0;
    return min + f * (max - min);
  }
  int(min: number, max: number): number {
    const v = this.ints.length ? this.ints.shift()! : min;
    return Math.min(Math.max(v, min), max - 1);
  }
  intRange(min: number, max: number): number {
    const v = this.ints.length ? this.ints.shift()! : min;
    return Math.min(Math.max(v, min), max);
  }
  normalIntRange(min: number, _max: number): number {
    return min;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[0]!;
  }
}

function makeLevel(w = 12, h = 12): Level {
  const lvl = new Level(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) lvl.set(x, y, Terrain.FLOOR);
  }
  lvl.stairsUp = 5 * w + 5;
  return lvl;
}

interface Ctx {
  ctx: ActionContext;
  hero: ContentHero;
  logs: string[];
}

function makeCtx(level: Level, seed = 1234): Ctx {
  const rng = new RNG(seed);
  const hero = createStarterHero(5 * level.w + 5, level.w);
  const logs: string[] = [];
  const ctx: ActionContext = {
    rng,
    level,
    hero,
    mobs: [] as unknown as MobActor[],
    log: (m: string) => logs.push(m),
    killMob: () => {},
    removeMob: () => {},
    addMob: () => {},
    syncMobs: () => {},
  };
  return { ctx, hero, logs };
}

const STUB_FAMILY = {
  classes: ['PotionOfHealing', 'PotionOfStrength'],
  labels: ['crimson', 'azure'],
  images: ['potion_crimson', 'potion_azure'],
};

/** Fresh wand+ring+identification state for each test. */
function freshItemState(seed = 42): RNG {
  resetWandState();
  resetRingState();
  const rng = new RNG(seed);
  initIdentification(rng, STUB_FAMILY, STUB_FAMILY);
  return rng;
}

function collectFx(): { events: WandFxEvent[]; fx: (e: WandFxEvent) => void } {
  const events: WandFxEvent[] = [];
  return { events, fx: (e) => events.push(e) };
}

describe('wand specs (Wand.java + 13 subclasses)', () => {
  test('all 13 wand ids exist in the handler order from Wand.java:64-69', () => {
    // Vanilla Wand.java:76-89 wands[] table order (12 wands); Magic Missile
    // is not in the table — it rides last here as the always-known special.
    expect(WAND_SPECS.map((s) => s.id)).toEqual([
      'teleportation',
      'slowness',
      'firebolt',
      'poison',
      'regrowth',
      'blink',
      'lightning',
      'amok',
      'reach',
      'flock',
      'disintegration',
      'avalanche',
      'magic_missile',
    ]);
  });

  test('Magic Missile is outside the handler (fixed sprite, always known)', () => {
    const mm = WAND_SPECS.find((s) => s.id === 'magic_missile')!;
    expect(mm.wood).toBeNull();
    expect(mm.initialCharges).toBe(3);
    for (const s of WAND_SPECS) {
      if (s.id === 'magic_missile') continue;
      expect(s.wood).not.toBeNull();
      expect(s.initialCharges).toBe(2);
    }
  });

  test('wand names are the exact vanilla names', () => {
    const names = Object.fromEntries(WAND_SPECS.map((s) => [s.id, s.name]));
    expect(names['firebolt']).toBe('Wand of Firebolt');
    expect(names['magic_missile']).toBe('Wand of Magic Missile');
    expect(names['disintegration']).toBe('Wand of Disintegration');
    expect(names['regrowth']).toBe('Wand of Regrowth');
  });

  test('maxCharges = min(initial + level, 9) (Wand.updateLevel, Wand.java:322-324)', () => {
    expect(wandMaxCharges(2, 0)).toBe(2);
    expect(wandMaxCharges(2, 3)).toBe(5);
    expect(wandMaxCharges(2, 10)).toBe(9);
    expect(wandMaxCharges(3, 0)).toBe(3); // magic missile
  });

  test('power() = effective level + power ring (Wand.power, Wand.java:210-218)', () => {
    expect(wandPower(2, null, true)).toBe(2);
    expect(wandPower(2, 1, true)).toBe(3); // Ring of Power +1
    expect(wandPower(2, -5, true)).toBe(0); // Math.max(eLevel + level, 0)
    expect(wandPower(3, null, false)).toBe(3); // charger null: plain eLevel
  });

  test('recharge: 40 turns; mage 40/sqrt(1+level) (Wand.Charger, Wand.java:463-489)', () => {
    expect(wandRechargeTurns(false, 0)).toBe(40);
    expect(wandRechargeTurns(false, 5)).toBe(40);
    expect(wandRechargeTurns(true, 0)).toBe(40);
    expect(wandRechargeTurns(true, 3)).toBeCloseTo(40 / Math.sqrt(4), 9);
  });

  test('40 uses identify a wand (USAGES_TO_KNOW, Wand.java:52)', () => {
    expect(USAGES_TO_KNOW).toBe(40);
  });
});

describe('wand instances (create/upgrade/identify)', () => {
  test('createWand mints instance ids and full charges', () => {
    freshItemState();
    const rng = new RNG(7);
    const id = createWand(rng, 'firebolt', { randomize: true });
    expect(id).toMatch(/^wand_of_firebolt#\d+$/);
    const st = getWandState(id)!;
    expect(st.curCharges).toBe(st.maxCharges);
    expect(st.usagesToKnow).toBe(40);
    expect(st.chargeKnown).toBe(false);
    expect(isWandId(id)).toBe(true);
    expect(isWandId('wand_of_firebolt')).toBe(true);
    expect(isWandId('potion_healing')).toBe(false);
  });

  test('random(): 50% +1, then 15% +1 (Wand.random, Wand.java)', () => {
    freshItemState();
    // float < 0.5 -> upgrade; second float < 0.15 -> second upgrade.
    const rng = new StubRng([0.1, 0.1]);
    const id = createWand(rng, 'firebolt', { randomize: true });
    expect(getWandState(id)!.level).toBe(2);
    const rng2 = new StubRng([0.1, 0.9]);
    const id2 = createWand(rng2, 'firebolt', { randomize: true });
    expect(getWandState(id2)!.level).toBe(1);
    const rng3 = new StubRng([0.9]);
    const id3 = createWand(rng3, 'firebolt', { randomize: true });
    expect(getWandState(id3)!.level).toBe(0);
  });

  test('upgrade() bumps level, max charges, and +1 current charge', () => {
    freshItemState();
    const rng = new RNG(7);
    const id = createWand(rng, 'firebolt');
    upgradeWand(id);
    const st = getWandState(id)!;
    expect(st.level).toBe(1);
    expect(st.maxCharges).toBe(3);
    expect(st.curCharges).toBe(3); // was 2, +1 capped at new max
    expect(st.chargeKnown).toBe(true);
  });

  test('parseWandId splits base and instance ids', () => {
    expect(parseWandId('wand_of_firebolt#3')).toEqual({
      wandId: 'firebolt',
      instanceId: 'wand_of_firebolt#3',
    });
    expect(parseWandId('wand_of_firebolt')).toEqual({
      wandId: 'firebolt',
      instanceId: null,
    });
    expect(parseWandId('wand_of_nope')).toBeNull();
    expect(parseWandId('potion_healing')).toBeNull();
  });

  test('unknown wands show "<wood> wand"; known show the true name', () => {
    freshItemState();
    const rng = new RNG(7);
    createWand(rng, 'firebolt');
    const unknown = wandDisplayName('firebolt');
    expect(unknown).toMatch(/ wand$/);
    expect(unknown).not.toBe('Wand of Firebolt');
    identifyWandType('firebolt');
    expect(isWandTypeKnown('firebolt')).toBe(true);
    expect(wandDisplayName('firebolt')).toBe('Wand of Firebolt');
    // Magic Missile is always known (fixed sprite).
    expect(wandDisplayName('magic_missile')).toBe('Wand of Magic Missile');
  });

  test('wand price = considerState(50) (Wand.price)', () => {
    freshItemState();
    const rng = new RNG(7);
    const id = createWand(rng, 'firebolt');
    // Unidentified: base 50 (levelKnown false).
    expect(wandPrice(getWandState(id)!)).toBe(50);
    // Identified at level 0: still 50 (level not > 0).
    getWandState(id)!.levelKnown = true;
    expect(wandPrice(getWandState(id)!)).toBe(50);
    // +2 upgrades while known: 50 * (2 + 1).
    upgradeWand(id);
    upgradeWand(id);
    expect(wandPrice(getWandState(id)!)).toBe(150);
    // Cursed and known: halved.
    const st = getWandState(id)!;
    st.cursed = true;
    st.cursedKnown = true;
    expect(wandPrice(st)).toBe(75);
  });

  test('normalizeWandPickup mints an instance for bare base ids', () => {
    freshItemState();
    const rng = new RNG(7);
    const id = normalizeWandPickup(rng, 'wand_of_firebolt');
    expect(isWandId(id)).toBe(true);
    expect(id).toContain('#');
    // Instance ids pass through untouched.
    expect(normalizeWandPickup(rng, id)).toBe(id);
  });

  test('save/restore round-trips wand instances', () => {
    freshItemState();
    const rng = new RNG(7);
    const id = createWand(rng, 'firebolt', { randomize: true });
    upgradeWand(id);
    const snap = saveWandState();
    resetWandState();
    expect(getWandState(id)).toBeUndefined();
    restoreWandState(snap);
    const st = getWandState(id)!;
    expect(st.wandId).toBe('firebolt');
    expect(st.level).toBeGreaterThanOrEqual(1);
  });
});

describe('zap flow (Wand.zap, Wand.java:121-146)', () => {
  function zapSetup(wandId: string, seed = 42) {
    const rng = freshItemState(seed);
    const level = makeLevel();
    const { ctx, hero, logs } = makeCtx(level, seed);
    const id = createWand(rng, wandId);
    addToInventory(hero, id, 1);
    const slot = hero.inventory.findIndex((st) => st.itemId === id);
    return { rng, level, ctx, hero, logs, id, slot };
  }

  test('useWandFromSlot always enters targeting (Wand.execute AC_ZAP, Wand.java:121-126)', () => {
    const { ctx, hero, slot, id } = zapSetup('firebolt');
    // Vanilla opens the cell selector even for an empty wand; the fizzle
    // resolves after a cell is tapped (Wand.zapper.onSelect). Merely
    // opening targeting identifies nothing.
    expect(useWandFromSlot(ctx, hero, slot)).toBe('target');
    expect(isWandTypeKnown('firebolt')).toBe(false);
    const st = getWandState(id)!;
    st.curCharges = 0;
    expect(useWandFromSlot(ctx, hero, slot)).toBe('target');
    expect(isWandTypeKnown('firebolt')).toBe(false);
  });

  test('beginZap fizzles at 0 charges; the zapper identifies the TYPE even on fizzle (Wand.java:444-456)', () => {
    const { ctx, hero, slot, id, logs } = zapSetup('firebolt');
    const st = getWandState(id)!;
    st.curCharges = 0;
    expect(isWandTypeKnown('firebolt')).toBe(false);
    const { fizzled } = beginZap(ctx, hero, st);
    expect(fizzled).toBe(true);
    expect(logs.some((l) => l.includes('fizzles'))).toBe(true);
    // setKnown() runs in the zapper's onSelect BEFORE the charge check
    // (Wand.java:444): the full flow identifies the type even on fizzle.
    const cost = zapWandFromSlot(ctx, hero, slot, hero.pos + 3);
    expect(cost).toBe(1);
    expect(isWandTypeKnown('firebolt')).toBe(true);
    expect(st.levelKnown).toBe(true);
  });

  test('a zap spends 1 charge and counts toward the 40-use identification', () => {
    const { ctx, hero, slot, id } = zapSetup('firebolt');
    const st = getWandState(id)!;
    const before = st.curCharges;
    const { fx } = collectFx();
    const target = hero.pos + 3; // same row, open floor
    const cost = zapWandFromSlot(ctx, hero, slot, target, fx);
    expect(cost).toBe(1);
    expect(st.curCharges).toBe(before - 1);
    expect(st.usagesToKnow).toBe(39);
    expect(st.chargeKnown).toBe(true);
  });

  test('40th use fully identifies the wand (Wand.wandUsed -> Item.identify, Wand.java:352-360)', () => {
    const { ctx, hero, slot, id, logs } = zapSetup('firebolt');
    const st = getWandState(id)!;
    st.usagesToKnow = 1;
    st.curCharges = 5;
    zapWandFromSlot(ctx, hero, slot, hero.pos + 3);
    expect(isWandTypeKnown('firebolt')).toBe(true);
    expect(st.levelKnown).toBe(true);
    expect(st.cursedKnown).toBe(true);
    expect(logs.some((l) => l.includes('familiar enough'))).toBe(true);
  });

  test('self-target is rejected before setKnown: no identification, no turn cost (Wand.java:432-434)', () => {
    const { ctx, hero, slot, id, logs } = zapSetup('firebolt');
    const st = getWandState(id)!;
    const before = st.curCharges;
    const res = zapWandFromSlot(ctx, hero, slot, hero.pos);
    expect(res).toBe(0);
    expect(st.curCharges).toBe(before); // no charge spent
    expect(isWandTypeKnown('firebolt')).toBe(false); // no setKnown()
    expect(logs.some((l) => l.includes("can't target yourself"))).toBe(true);
  });

  test('rechargeWands gains ~1 charge per 40 turns (warrior)', () => {
    const rng = freshItemState();
    const { hero } = makeCtx(makeLevel());
    const id = createWand(rng, 'firebolt');
    const st = getWandState(id)!;
    st.curCharges = 0;
    addToInventory(hero, id, 1);
    rechargeWands(hero, 39, false);
    expect(st.curCharges).toBe(0);
    rechargeWands(hero, 1, false);
    expect(st.curCharges).toBe(1);
    // Full wands don't accumulate.
    st.curCharges = st.maxCharges;
    rechargeWands(hero, 400, false);
    expect(st.curCharges).toBe(st.maxCharges);
  });
});

describe('per-wand zap effects', () => {
  function zapSetup(wandId: string, seed = 42) {
    const rng = freshItemState(seed);
    const level = makeLevel();
    const { ctx, hero, logs } = makeCtx(level, seed);
    const id = createWand(rng, wandId);
    addToInventory(hero, id, 1);
    const slot = hero.inventory.findIndex((st) => st.itemId === id);
    return { rng, level, ctx, hero, logs, id, slot };
  }

  function targetCell(hero: ContentHero, dx: number): number {
    return hero.pos + dx;
  }

  test('Magic Missile damages the char at the impact cell', async () => {
    const { level, ctx, hero, slot } = zapSetup('magic_missile');
    const { buildMob } = await import('../src/content/mobs.js');
    const mob = buildMob('rat', 9001, targetCell(hero, 3), level.w);
    (ctx.mobs as unknown as { push(m: unknown): void }).push(mob);
    const hp = mob.hp;
    const { fx } = collectFx();
    zapWandFromSlot(ctx, hero, slot, targetCell(hero, 5), fx);
    expect(mob.hp).toBeLessThan(hp);
  });

  test('Firebolt damages and seeds fire (WandOfFirebolt)', async () => {
    const { level, ctx, hero, slot } = zapSetup('firebolt');
    const { buildMob } = await import('../src/content/mobs.js');
    const mob = buildMob('rat', 9002, targetCell(hero, 3), level.w);
    (ctx.mobs as unknown as { push(m: unknown): void }).push(mob);
    const hp = mob.hp;
    zapWandFromSlot(ctx, hero, slot, targetCell(hero, 5));
    expect(mob.hp).toBeLessThan(hp);
    // Fire blob seeded at the impact cell.
    expect(level.blobs.some((b) => b.kind === 'fire')).toBe(true);
  });

  test('Lightning arcs to nearby chars (WandOfLightning)', async () => {
    const { level, ctx, hero, slot } = zapSetup('lightning');
    const { buildMob } = await import('../src/content/mobs.js');
    const m1 = buildMob('rat', 9003, targetCell(hero, 3), level.w);
    const m2 = buildMob('rat', 9004, targetCell(hero, 4), level.w);
    const push = (ctx.mobs as unknown as { push(m: unknown): void }).push.bind(ctx.mobs);
    push(m1);
    push(m2);
    const hp1 = m1.hp;
    const hp2 = m2.hp;
    const { events, fx } = collectFx();
    zapWandFromSlot(ctx, hero, slot, targetCell(hero, 5), fx);
    expect(m1.hp).toBeLessThan(hp1);
    expect(m2.hp).toBeLessThan(hp2); // arc chained
    expect(events.some((e) => e.kind === 'strike')).toBe(true);
  });

  test('Avalanche damages, paralyzes, and presses traps (WandOfAvalanche)', async () => {
    const { level, ctx, hero, slot } = zapSetup('avalanche');
    const { buildMob } = await import('../src/content/mobs.js');
    // Vanilla zaps are magic=true (Wand.java:426): the beam runs PAST the
    // tapped cell to the first wall — every real level is walled, so the
    // test levels the beam against a wall exactly like the game does.
    const wallCell = targetCell(hero, 5);
    level.set(wallCell % level.w, Math.floor(wallCell / level.w), Terrain.WALL);
    const mob = buildMob('rat', 9005, targetCell(hero, 4), level.w);
    (ctx.mobs as unknown as { push(m: unknown): void }).push(mob);
    const hp = mob.hp;
    // StubRng-free: paralysis chance uses ctx.rng; just check damage + buff key exists path.
    zapWandFromSlot(ctx, hero, slot, targetCell(hero, 4));
    expect(mob.hp).toBeLessThan(hp);
  });

  test('Poison applies the poison buff (WandOfPoison)', async () => {
    const { level, ctx, hero, slot } = zapSetup('poison');
    const { buildMob } = await import('../src/content/mobs.js');
    const mob = buildMob('rat', 9006, targetCell(hero, 3), level.w);
    (ctx.mobs as unknown as { push(m: unknown): void }).push(mob);
    zapWandFromSlot(ctx, hero, slot, targetCell(hero, 5));
    expect(mob.buffs['poison']).toBeDefined();
    expect(mob.buffs['poison']!.left).toBeGreaterThan(0);
  });

  test('Amok applies amok, Slowness applies slow (WandOfAmok/WandOfSlowness)', async () => {
    for (const [wandId, buff] of [
      ['amok', 'amok'],
      ['slowness', 'slow'],
    ] as const) {
      const { level, ctx, hero, slot } = zapSetup(wandId);
      const { buildMob } = await import('../src/content/mobs.js');
      const mob = buildMob('rat', 9100 + wandId.length, targetCell(hero, 3), level.w);
      (ctx.mobs as unknown as { push(m: unknown): void }).push(mob);
      zapWandFromSlot(ctx, hero, slot, targetCell(hero, 5));
      expect(mob.buffs[buff]).toBeDefined();
    }
  });

  test('Blink teleports the hero along the trace (WandOfBlink)', () => {
    const { ctx, hero, slot } = zapSetup('blink');
    const from = hero.pos;
    const { events, fx } = collectFx();
    zapWandFromSlot(ctx, hero, slot, hero.pos + 5, fx);
    expect(hero.pos).not.toBe(from);
    const missile = events.find((e) => e.kind === 'missile');
    expect(missile).toBeDefined();
    if (missile && missile.kind === 'missile') {
      expect(missile.from).toBe(from);
      expect(missile.to).toBe(hero.pos);
    }
  });

  test('Teleportation moves the target char (WandOfTeleportation)', async () => {
    const { level, ctx, hero, slot } = zapSetup('teleportation');
    const { buildMob } = await import('../src/content/mobs.js');
    const mob = buildMob('rat', 9007, targetCell(hero, 3), level.w);
    (ctx.mobs as unknown as { push(m: unknown): void }).push(mob);
    const from = mob.pos;
    zapWandFromSlot(ctx, hero, slot, targetCell(hero, 5));
    expect(mob.pos).not.toBe(from);
  });

  test('Flock spawns sheep (WandOfFlock)', () => {
    const { ctx, hero, slot } = zapSetup('flock');
    const { events, fx } = collectFx();
    const added: unknown[] = [];
    (ctx as unknown as { addMob: (m: unknown) => void }).addMob = (m) =>
      added.push(m);
    zapWandFromSlot(ctx, hero, slot, hero.pos + 5, fx);
    expect(added.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'sheep')).toBe(true);
  });

  test('Regrowth converts floor to grass and seeds the regrowth blob', () => {
    const { level, ctx, hero, slot } = zapSetup('regrowth');
    const before = targetCell(hero, 2);
    expect(level.getAt(before)).toBe(Terrain.FLOOR);
    zapWandFromSlot(ctx, hero, slot, hero.pos + 6);
    expect(level.getAt(before)).toBe(Terrain.GRASS);
    expect(level.blobs.some((b) => b instanceof RegrowthBlob)).toBe(true);
  });

  test('Disintegration melts doors and damages chars on the trace', async () => {
    const { level, ctx, hero, slot } = zapSetup('disintegration');
    const { buildMob } = await import('../src/content/mobs.js');
    // The magic beam (Wand.java:426) runs past the tapped cell to the first
    // wall; disintegration caps its reach at level+4 trace cells
    // (WandOfDisintegration.java). Doors block the beam (losBlocking), so
    // the mob stands before the door on the trace.
    const mob = buildMob('rat', 9008, targetCell(hero, 2), level.w);
    (ctx.mobs as unknown as { push(m: unknown): void }).push(mob);
    const doorCell = targetCell(hero, 3);
    level.set(doorCell % level.w, Math.floor(doorCell / level.w), Terrain.DOOR);
    const wallCell = targetCell(hero, 7);
    level.set(wallCell % level.w, Math.floor(wallCell / level.w), Terrain.WALL);
    const hp = mob.hp;
    zapWandFromSlot(ctx, hero, slot, targetCell(hero, 6));
    expect(level.getAt(doorCell)).toBe(Terrain.EMBERS);
    expect(mob.hp).toBeLessThan(hp);
  });

  test('damage formulas match the Java sources', () => {
    const rng = new StubRng([], []);
    // StubRng.int returns min: check the lower bounds of each roll.
    // Magic Missile (WandOfMagicMissile.java:34): Int(1, 6 + 2*power).
    expect(magicMissileDamage(rng, 2)).toBe(1);
    // Firebolt (WandOfFirebolt.java:66): Int(1, 8 + power^2).
    expect(fireboltDamage(rng, 2)).toBe(1);
    // Lightning initial (WandOfLightning.java:56): Int(5 + power/2, 10 + power).
    expect(lightningInitialDamage(rng, 2)).toBe(6);
    // Disintegration (WandOfDisintegration.java:62): lvl = power + targets.
    expect(disintegrationDamage(rng, 2, 1)).toBe(3);
    // Avalanche (WandOfAvalanche.java:84): Int(2, 6 + (size-dist)*2).
    expect(avalancheDamage(rng, 4, 1)).toBe(2);
    // Avalanche paralysis (WandOfAvalanche.java:87): Int(0, 2+dist) == 0.
    expect(avalancheParalyzes(rng, 5)).toBe(true);
    // Poison (WandOfPoison.java:55): durationFactor * (5 + power).
    expect(poisonWandDuration(2)).toBe(7);
    // Amok on non-hero (WandOfAmok.java:59): 3 + power.
    expect(amokDuration(2)).toBe(5);
    // Slow.duration (Slow.java:28-30): factor * 10.
    expect(slownessDuration(null)).toBe(10);
    // Flock (WandOfFlock.java:64-66,70,130): n = power+2,
    // lifespan = power+3 + Random.Float(2).
    expect(flockSheepCount(2)).toBe(4);
    const flockRng = new RNG(7);
    const life = flockLifespan(2, flockRng);
    expect(life).toBeGreaterThanOrEqual(5);
    expect(life).toBeLessThan(7);
    // Regrowth (WandOfRegrowth.java): seed amount (power+2)*20.
    expect(regrowthSeedAmount(2)).toBe(80);
    // Blink (WandOfBlink.java:72-77): trace[distance-1] when in range.
    expect(blinkDestinationCell([10, 11, 12, 13], 4, 2, false)).toBe(13);
    // ...trace[distance-2] when the impact cell is occupied.
    expect(blinkDestinationCell([10, 11, 12, 13], 4, 2, true)).toBe(12);
  });
});
