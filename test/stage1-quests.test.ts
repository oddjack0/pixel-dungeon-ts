/**
 * Stage 1 quest tests: Sad Ghost quest, Wandmaker quest, NPC interaction,
 * and modal dialogs — all grounded in the Java sources.
 *
 * Sources:
 * - Ghost.java:48-105 (behavior), 233-320 (Quest), 346-461 (interact)
 * - WndSadGhost.java:30-67 (reward window)
 * - Wandmaker.java:46-95 (behavior), 155-230 (Quest), 268-391 (interact)
 * - WndWandmaker.java:34-76 (reward window)
 * - FetidRat.java:32-88, CursePersonification.java:36-116
 * - NPC.java:25-53 (invulnerability)
 * - Hero.java:498-516 (NPC interaction)
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Game } from '../src/engine/loop.js';
import { contentLevelGen } from '../src/content/spawns.js';
import { contentMechanics } from '../src/content/hooks.js';
import {
  GhostMob,
  WandmakerMob,
  FetidRatMob,
  CurseMob,
  ghostQuest,
  wandmakerQuest,
  initGhostQuest,
  initWandmakerQuest,
  onSewersKill,
  resetQuestState,
} from '../src/content/npcs.js';
import {
  showDialog,
  dismissDialog,
  resolveDialog,
  dialogOpen,
  currentDialog,
} from '../src/ui/dialog.js';
import type { ActionContext, MobActor } from '../src/engine/seams.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const store = new Map<string, string>();
(globalThis as Record<string, unknown>)['localStorage'] = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => {
    store.set(k, String(v));
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
};

function makeGame(seed = 42): Game {
  return new Game(seed, {
    gen: contentLevelGen,
    mechanics: contentMechanics,
  });
}

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  const game = makeGame();
  const mobs: MobActor[] = [];
  const ctx = {
    level: game.level,
    hero: game.hero,
    mobs,
    rng: new RNG(123),
    addMob: (mob: MobActor) => {
      mobs.push(mob);
    },
    removeMob: (mob: MobActor) => {
      const i = mobs.indexOf(mob);
      if (i >= 0) mobs.splice(i, 1);
    },
    ...overrides,
  } as ActionContext;
  return ctx;
}

beforeEach(() => {
  resetQuestState();
});

// ---------------------------------------------------------------------------
// Dialog system
// ---------------------------------------------------------------------------

describe('modal dialogs', () => {
  test('showDialog resolves with the chosen value', async () => {
    const p = showDialog({
      title: 'Test',
      text: 'Hello',
      choices: [
        { label: 'OK', value: 'ok' },
        { label: 'Cancel', value: 'cancel' },
      ],
    });
    expect(dialogOpen()).toBe(true);
    expect(currentDialog()?.choices).toHaveLength(2);
    resolveDialog('cancel');
    expect(await p).toBe('cancel');
    expect(dialogOpen()).toBe(false);
  });

  test('dismissDialog resolves with empty string', async () => {
    const p = showDialog({ title: 'T', text: 'x', choices: [] });
    expect(dialogOpen()).toBe(true);
    dismissDialog();
    expect(await p).toBe('');
    expect(dialogOpen()).toBe(false);
  });

  test('dialog text carries _highlight_ spans', async () => {
    const p = showDialog({
      title: 'T',
      text: 'Find the _Dried Rose_ now',
      choices: [{ label: 'OK', value: 'ok' }],
    });
    expect(currentDialog()?.text).toContain('_Dried Rose_');
    resolveDialog('ok');
    await p;
  });
});

// ---------------------------------------------------------------------------
// Ghost quest state
// ---------------------------------------------------------------------------

describe('sad ghost quest', () => {
  test('initGhostQuest sets spawned, depth, type (Ghost.java:233-296)', () => {
    const rng = new RNG(999);
    initGhostQuest(rng, 3);
    expect(ghostQuest.spawned).toBe(true);
    expect(ghostQuest.depth).toBe(3);
    expect(['rose', 'rat', 'curse']).toContain(ghostQuest.type!);
    expect(ghostQuest.given).toBe(false);
    expect(ghostQuest.processed).toBe(false);
    // Weapon/armor reward IDs are drawn (best-of-four simplified)
    expect(ghostQuest.weaponId).toBeTruthy();
    expect(ghostQuest.armorId).toBeTruthy();
  });

  test('onSewersKill is a no-op before quest is given (Ghost.java:299-320)', () => {
    const rng = new RNG(1);
    initGhostQuest(rng, 2);
    const rngStateBefore = rng.serialize();
    const ctx = makeCtx({ rng });
    ghostQuest.type = 'rose';
    ghostQuest.left2kill = 8;
    onSewersKill(ctx, 100);
    expect(ghostQuest.processed).toBe(false);
    expect(ghostQuest.left2kill).toBe(8);
    // No RNG consumed while the guard rejects
    expect(rng.serialize()).toBe(rngStateBefore);
  });

  test('onSewersKill is a no-op on the wrong depth (Ghost.java:299-320)', () => {
    const rng = new RNG(1);
    initGhostQuest(rng, 2);
    ghostQuest.given = true;
    ghostQuest.type = 'rose';
    const ctx = makeCtx({ rng });
    expect(ctx.level.depth).not.toBe(2);
    const before = ghostQuest.left2kill;
    onSewersKill(ctx, 100);
    expect(ghostQuest.left2kill).toBe(before);
    expect(ghostQuest.processed).toBe(false);
  });

  test('onSewersKill rose: 1/(left2kill+1) drops the rose (Ghost.java:299-320)', () => {
    const ctx = makeCtx();
    ghostQuest.spawned = true;
    ghostQuest.given = true;
    ghostQuest.processed = false;
    ghostQuest.depth = ctx.level.depth;
    ghostQuest.type = 'rose';
    ghostQuest.left2kill = 0; // 1/(0+1) = guaranteed
    onSewersKill(ctx, 100);
    expect(ghostQuest.processed).toBe(true);
  });

  test('onSewersKill rat: spawns a fetid rat (Ghost.java:299-320)', () => {
    const ctx = makeCtx();
    ghostQuest.spawned = true;
    ghostQuest.given = true;
    ghostQuest.processed = false;
    ghostQuest.depth = ctx.level.depth;
    ghostQuest.type = 'rat';
    onSewersKill(ctx, 100);
    expect(ghostQuest.processed).toBe(true);
    expect(ctx.mobs.some((m) => m instanceof FetidRatMob)).toBe(true);
  });

  test('onSewersKill curse: default branch does nothing (Ghost.java:299-320)', () => {
    const ctx = makeCtx();
    ghostQuest.spawned = true;
    ghostQuest.given = true;
    ghostQuest.processed = false;
    ghostQuest.depth = ctx.level.depth;
    ghostQuest.type = 'curse';
    const mobsBefore = ctx.mobs.length;
    onSewersKill(ctx, 100);
    expect(ghostQuest.processed).toBe(false);
    expect(ctx.mobs.length).toBe(mobsBefore);
  });

  test('GhostMob exposes onTalk, is non-hostile and invulnerable (NPC.java:25-53)', () => {
    const ghost = new GhostMob(1, 100, 32);
    expect(typeof ghost.onTalk).toBe('function');
    expect(ghost.hostile).toBe(false);
    expect(ghost.invulnerable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fetid Rat
// ---------------------------------------------------------------------------

describe('fetid rat', () => {
  test('has 15 HP and is hostile (FetidRat.java:32-88)', () => {
    const rat = new FetidRatMob(1, 100, 32);
    expect(rat.ht).toBe(15);
    expect(rat.hostile).toBe(true);
  });

  test('is immune to paralysis (FetidRat.java:32-88)', () => {
    const rat = new FetidRatMob(1, 100, 32);
    expect(rat.immunities).toContain('paralysis');
  });

  test('onDeath drops the rat skull (FetidRat.java:85-88)', () => {
    const ctx = makeCtx();
    const rat = new FetidRatMob(1, 100, 32);
    rat.pos = 55;
    rat.onDeath(ctx);
    expect(ctx.level.items.some((it) => it.itemId === 'rat_skull')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Curse Personification
// ---------------------------------------------------------------------------

describe('curse personification', () => {
  test('HP scales with depth: 10 + depth*3 (CursePersonification.java:36-116)', () => {
    const curse2 = new CurseMob(1, 100, 32, 2);
    const curse4 = new CurseMob(2, 100, 32, 4);
    expect(curse2.ht).toBe(10 + 2 * 3);
    expect(curse4.ht).toBe(10 + 4 * 3);
  });

  test('flies and hunts (CursePersonification.java:36-116)', () => {
    const curse = new CurseMob(1, 100, 32, 3);
    expect(curse.flying).toBe(true);
    expect(curse.hostile).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wandmaker quest
// ---------------------------------------------------------------------------

describe('wandmaker quest', () => {
  test('initWandmakerQuest sets spawned and type (Wandmaker.java:155-230)', () => {
    const rng = new RNG(777);
    initWandmakerQuest(rng, 50, 1024);
    expect(wandmakerQuest.spawned).toBe(true);
    expect(['berry', 'dust', 'fish']).toContain(wandmakerQuest.type!);
    expect(wandmakerQuest.given).toBe(false);
  });

  test('WandmakerMob exposes onTalk and is non-hostile (NPC.java:25-53)', () => {
    const wm = new WandmakerMob(1, 100, 32);
    expect(typeof wm.onTalk).toBe('function');
    expect(wm.hostile).toBe(false);
    expect(wm.invulnerable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NPC interaction
// ---------------------------------------------------------------------------

describe('NPC interaction', () => {
  test('talk intent dispatches to onTalk (Hero.java:498-516)', async () => {
    const game = makeGame();
    const heroPos = game.hero.y * game.level.w + game.hero.x;
    const ghost = new GhostMob(999, heroPos + 1, game.level.w);
    game.mobs.push(ghost);
    // The talk intent routes to the NPC's onTalk without error
    game.queueIntent({ kind: 'talk', targetId: ghost.id } as never);
    expect(() => game.drain()).not.toThrow();
    // Ghost starts talking: a dialog is queued
    expect(dialogOpen()).toBe(true);
    // Clean up the dialog
    dismissDialog();
  });
});
