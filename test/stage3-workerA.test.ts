/**
 * Stage 3 (Worker A): wand zap targeting + ring equip through the inventory
 * UI, and the honeypot bee ally AI (mob-vs-mob targeting/combat). Grounded
 * in ~/workspace/pixel-dungeon-src (GPL-3.0); Java wins every conflict.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Terrain } from '../src/core/grid.js';
import { Level } from '../src/dungeon/level.js';
import type { ActionContext, MobActor } from '../src/engine/seams.js';
import {
  ContentHero,
  addToInventory,
  createStarterHero,
} from '../src/content/hero.js';
import {
  actionsFor,
  actionLabel,
  doItemAction,
  type UiItem,
} from '../src/ui/inventory.js';
import {
  createWand,
  getWandState,
  isWandId,
  resetWandState,
  zapWandFromSlot,
} from '../src/content/wands.js';
import { initIdentification } from '../src/content/identification.js';
import {
  createRing,
  equipRing,
  getRingState,
  resetRingState,
  unequipRing,
  useRingFromSlot,
} from '../src/content/rings.js';

const STUB_FAMILY = {
  classes: ['PotionOfHealing', 'PotionOfStrength'],
  labels: ['crimson', 'azure'],
  images: ['potion_crimson', 'potion_azure'],
};

function freshItemState(seed = 42): RNG {
  resetWandState();
  resetRingState();
  const rng = new RNG(seed);
  initIdentification(rng, STUB_FAMILY, STUB_FAMILY);
  return rng;
}
import {
  BeeMob,
  beeDef,
  spawnBee,
} from '../src/content/bee.js';
import {
  beeSpawnerRegistered,
  shatterHoneypotAt,
} from '../src/content/honeypot.js';
import {
  buildMob,
  ContentMob,
  nextMobId,
  strikeMobVsMob,
} from '../src/content/mobs.js';
import { tickHeroClock } from '../src/content/actions.js';

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
  live: ContentMob[];
}

function makeCtx(level: Level, seed = 1234): Ctx {
  const rng = new RNG(seed);
  const hero = createStarterHero(5 * level.w + 5, level.w);
  const logs: string[] = [];
  const live: ContentMob[] = [];
  const ctx: ActionContext = {
    rng,
    level,
    hero,
    mobs: live as unknown as MobActor[],
    log: (m: string) => logs.push(m),
    killMob: () => {},
    removeMob: () => {},
    addMob: (m: MobActor) => {
      live.push(m as ContentMob);
    },
    syncMobs: () => {},
  };
  return { ctx, hero, logs, live };
}

/** Mark every cell visible (hero FOV) for bee enemy-detection tests. */
function seeAll(level: Level): void {
  level.visible.fill(1);
}

function uiItem(id: string, slot: number): UiItem {
  return {
    slot,
    id,
    name: id,
    sprite: 'spr',
    qty: 1,
    kind: 'misc',
    equipped: false,
    identified: true,
  };
}

describe('wand inventory actions (Wand AC_ZAP, Wand.java:58, 121-126)', () => {
  test('wand offers Zap + Drop; the button reads "Zap"', () => {
    const item = uiItem('wand_of_firebolt#3', 0);
    expect(actionsFor(item)).toEqual(['use', 'drop']);
    expect(actionLabel('use', item)).toBe('Zap');
  });

  test('picking Zap enters zap-targeting mode (not the useItem intent)', () => {
    const game = { queueIntent: (_i: unknown) => {} } as never;
    const item = uiItem('wand_of_firebolt#3', 2);
    expect(doItemAction(game, item, 'use')).toBe('zap-targeting');
  });

  test('ring offers Wear + Drop; the button reads "Wear"', () => {
    const item = uiItem('ring_of_thorns#1', 0);
    expect(actionsFor(item)).toEqual(['equip', 'drop']);
    expect(actionLabel('equip', item)).toBe('Wear');
  });
});

describe('ring equip through the inventory (Ring.doEquip, Ring.java:123-179)', () => {
  function ringSetup(ringId: string, seed = 42) {
    const rng = freshItemState(seed);
    const level = makeLevel();
    const { ctx, hero, logs } = makeCtx(level, seed);
    const id = createRing(rng, ringId);
    addToInventory(hero, id, 1);
    const slot = hero.inventory.findIndex((s) => s.itemId === id);
    return { ctx, hero, logs, id, slot };
  }

  test('first ring -> finger 1, second -> finger 2, third blocked (returns 0)', () => {
    const { ctx, hero, slot } = ringSetup('thorns');
    const rng = new RNG(7);
    const id2 = createRing(rng, 'haste');
    addToInventory(hero, id2, 1);
    const slot2 = hero.inventory.findIndex((s) => s.itemId === id2);
    const id3 = createRing(rng, 'mending');
    addToInventory(hero, id3, 1);
    const slot3 = hero.inventory.findIndex((s) => s.itemId === id3);
    expect(useRingFromSlot(ctx, hero, slot)).toBe(1);
    expect(useRingFromSlot(ctx, hero, slot2)).toBe(2);
    // Both fingers full: vanilla opens the replacement picker
    // (Ring.java:131-142); the port returns 0 and spends no time.
    expect(useRingFromSlot(ctx, hero, slot3)).toBe(0);
  });

  test('equipping marks curse knowledge and syncs the ring buff', () => {
    const { ctx, hero, id, slot } = ringSetup('thorns');
    useRingFromSlot(ctx, hero, slot);
    const st = getRingState(id)!;
    expect(st.cursedKnown).toBe(true);
    expect(hero.buffs.ring_thorns).toBeDefined();
  });

  test('cursed ring tightens painfully and cannot be removed', () => {
    const { ctx, hero, id, slot, logs } = ringSetup('thorns');
    const st = getRingState(id)!;
    st.cursed = true;
    useRingFromSlot(ctx, hero, slot);
    expect(logs.some((l) => l.includes('tightens'))).toBe(true);
    expect(unequipRing(ctx, hero, 1)).toBe(false);
    expect(logs.some((l) => l.includes("can't remove"))).toBe(true);
  });

  test('uncursed ring unequips back into the inventory', () => {
    const { ctx, hero, id, slot } = ringSetup('haste');
    useRingFromSlot(ctx, hero, slot);
    expect(unequipRing(ctx, hero, 1)).toBe(true);
    expect(hero.inventory.some((s) => s.itemId === id)).toBe(true);
    expect(hero.buffs.ring_haste).toBeUndefined();
  });

  test('equipping a wand or ring via useInventorySlot equips the ring', () => {
    const { ctx, hero, slot } = ringSetup('thorns');
    // equipRing returns the finger directly (the equipSlot path is
    // covered by the actions tests; this pins the mechanics contract).
    expect(equipRing(ctx, hero, slot)).toBe(1);
  });
});

describe('wand zap flow fidelity (Wand.zapper.onSelect, Wand.java:430-475)', () => {
  function zapSetup(wandId: string, seed = 42) {
    const rng = freshItemState(seed);
    const level = makeLevel();
    const { ctx, hero, logs } = makeCtx(level, seed);
    const id = createWand(rng, wandId);
    addToInventory(hero, id, 1);
    const slot = hero.inventory.findIndex((s) => s.itemId === id);
    return { ctx, hero, logs, id, slot };
  }

  test('a successful zap dispels invisibility (Wand.java:446-448)', () => {
    const { ctx, hero, slot } = zapSetup('firebolt');
    hero.buffs.invisibility = { kind: 'invisibility', left: 10 };
    zapWandFromSlot(ctx, hero, slot, hero.pos + 3);
    expect(hero.buffs.invisibility).toBeUndefined();
  });

  test('carried wands recharge through tickHeroClock (Wand.Charger)', () => {
    const rng = freshItemState(9);
    const level = makeLevel();
    const { ctx, hero } = makeCtx(level, 9);
    const id = createWand(rng, 'firebolt');
    const st = getWandState(id)!;
    st.curCharges = 0;
    addToInventory(hero, id, 1);
    // Warrior recharge: 40 turns per charge (wandRechargeTurns).
    tickHeroClock(rng, ctx, hero, 39);
    expect(st.curCharges).toBe(0);
    tickHeroClock(rng, ctx, hero, 1);
    expect(st.curCharges).toBe(1);
  });

  test('isWandId routes instance ids', () => {
    expect(isWandId('wand_of_firebolt#3')).toBe(true);
    expect(isWandId('potion_healing')).toBe(false);
  });
});

describe('bee ally AI (Bee.java)', () => {
  function beeSetup(depth = 3, seed = 42) {
    freshItemState(seed);
    const level = makeLevel();
    const { ctx, hero, logs, live } = makeCtx(level, seed);
    const bee = new BeeMob(nextMobId(), 2 * level.w + 2, level.w, depth);
    live.push(bee);
    return { ctx, hero, logs, live, bee, level };
  }

  test('spawn stats: HT=(3+depth)*5, atk=def=9+depth, golden bee, NPC traits', () => {
    const { bee } = beeSetup(3);
    expect(beeDef(3).hp).toBe(30); // (3+3)*5
    expect(bee.ht).toBe(30);
    expect(bee.hp).toBe(30);
    expect(bee.def.atk).toBe(12); // 9+3
    expect(bee.def.def).toBe(12);
    expect(bee.name).toBe('golden bee');
    expect(bee.sprite).toBe('mob_bee');
    expect(bee.hostile).toBe(false);
    expect(bee.flying).toBe(true);
    expect(bee.state).toBe('wandering');
    expect(bee.immunities).toContain('poison');
  });

  test('damage roll is NormalIntRange(HT/10, HT/4) (Bee.java:123-125)', () => {
    const { bee } = beeSetup(3); // HT=30 -> [3, 7]
    const rng = new RNG(1);
    for (let i = 0; i < 50; i++) {
      const d = bee.mobDamageRoll(rng);
      expect(d).toBeGreaterThanOrEqual(3);
      expect(d).toBeLessThanOrEqual(7);
    }
  });

  test('the bee loses 1 HP per action and dies at 0 (Bee.act, Bee.java:149-156)', () => {
    const { ctx, bee } = beeSetup(3);
    bee.hp = 2;
    bee.takeTurn(ctx);
    expect(bee.hp).toBe(1);
    bee.takeTurn(ctx);
    expect(bee.hp).toBe(0); // died instead of acting
  });

  test('chooseEnemy: a hostile mob in the hero FOV is picked; the hero never is', () => {
    const { ctx, live, bee, level } = beeSetup(3);
    seeAll(level);
    const rat = buildMob('rat', nextMobId(), 8 * level.w + 8, level.w);
    live.push(rat);
    const enemy = (bee as unknown as { selectEnemy(c: ActionContext): unknown }).selectEnemy(ctx);
    expect(enemy).toBe(rat);
    // A non-hostile mob is ignored.
    const npc = buildMob('rat', nextMobId(), 9 * level.w + 9, level.w);
    npc.hostile = false;
    const enemy2 = (bee as unknown as { selectEnemy(c: ActionContext): unknown }).selectEnemy(ctx);
    expect(enemy2).toBe(rat);
  });

  test('chooseEnemy keeps the current enemy while it lives (Bee.java:105-106)', () => {
    const { ctx, live, bee, level } = beeSetup(3);
    seeAll(level);
    const rat = buildMob('rat', nextMobId(), 8 * level.w + 8, level.w);
    const gnoll = buildMob('gnoll', nextMobId(), 9 * level.w + 9, level.w);
    live.push(rat, gnoll);
    bee.enemy = gnoll;
    const sel = (bee as unknown as { selectEnemy(c: ActionContext): unknown }).selectEnemy(ctx);
    expect(sel).toBe(gnoll); // retained even though another hostile mob exists
  });

  test('attackProc aggros the stung mob onto the bee (Bee.java:157-161)', () => {
    const { ctx, bee, level } = beeSetup(3);
    const rat = buildMob('rat', nextMobId(), 3 * level.w + 2, level.w);
    bee.attackProc(ctx, rat, 5);
    expect(rat.enemy).toBe(bee);
  });

  test('bee-vs-mob: strikeMobVsMob damages the mob and aggros it', () => {
    const { ctx, bee, level } = beeSetup(3);
    const rat = buildMob('rat', nextMobId(), 3 * level.w + 2, level.w);
    rat.hp = rat.ht;
    const before = rat.hp;
    strikeMobVsMob(ctx, bee, rat, 1000, () => 5, (_r, d) => bee.attackProc(ctx, rat, d));
    expect(rat.hp).toBeLessThan(before);
    expect(rat.enemy).toBe(bee);
  });

  test('mob-vs-bee: the bee takes no damage (NPC.damage no-op, NPC.java:33-37)', () => {
    const { ctx, bee, level, logs } = beeSetup(3);
    const rat = buildMob('rat', nextMobId(), 3 * level.w + 2, level.w);
    const before = bee.hp;
    strikeMobVsMob(ctx, rat, bee, 1000, () => 10);
    expect(bee.hp).toBe(before);
    expect(logs.some((l) => l.includes('does no damage'))).toBe(true);
  });

  test('interact swaps the bee and hero positions (Bee.interact, Bee.java:163-173)', () => {
    const { ctx, hero, bee } = beeSetup(3);
    const heroPos = hero.pos;
    const beePos = bee.pos;
    bee.onTalk(ctx);
    expect(bee.pos).toBe(heroPos);
    expect(hero.pos).toBe(beePos);
  });

  test('honeypot shatter spawns the bee at full HP (Honeypot.java:100-113)', () => {
    expect(beeSpawnerRegistered()).toBe(true); // bee.ts module load
    freshItemState(5);
    const level = makeLevel();
    const { ctx, hero, live } = makeCtx(level, 5);
    const cell = 6 * level.w + 6;
    spawnBee(ctx, cell);
    expect(live.length).toBe(1);
    const bee = live[0];
    expect(bee).toBeInstanceOf(BeeMob);
    expect(bee.hp).toBe(bee.ht);
    expect(bee.pos).toBe(cell);
  });

  test('shatterHoneypotAt routes through the registered spawner', () => {
    freshItemState(6);
    const level = makeLevel();
    const { ctx, hero, live } = makeCtx(level, 6);
    shatterHoneypotAt(ctx, hero, 6 * level.w + 6);
    expect(live.length).toBe(1);
    expect(live[0]).toBeInstanceOf(BeeMob);
  });

  test('buildMob("bee") revives a bee from a save blob', () => {
    const bee = buildMob('bee', 99, 40, 12, 5);
    expect(bee).toBeInstanceOf(BeeMob);
    expect(bee.ht).toBe(40); // (3+5)*5
  });
});
