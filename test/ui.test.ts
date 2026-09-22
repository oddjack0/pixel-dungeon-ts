/**
 * UI tests (headless). Panel state transitions, log buffer fading, inventory
 * adapter output for the warrior kit, minimap folding on a real generated
 * Sewers level, effects diffing, and screen state machines. Draw calls run
 * against a no-op canvas proxy so "doesn't crash" is asserted for real.
 */
import { describe, expect, test } from 'bun:test';
import { RNG } from '../src/core/rng.js';
import { Game } from '../src/engine/loop.js';
import { stubLevelGen } from '../src/dungeon/level.js';
import { stubMechanics } from '../src/engine/stubs.js';
import { generateLevel, newRunState } from '../src/dungeon/generator.js';
import type { HeroActor } from '../src/engine/seams.js';
import { readHeroView } from '../src/ui/heroView.js';
import { LogBuffer } from '../src/ui/hud.js';
import {
  actionsFor,
  defaultInventoryAdapter,
  doItemAction,
  InventoryPanel,
  readInventory,
} from '../src/ui/inventory.js';
import { computeMinimap, Minimap, MM } from '../src/ui/minimap.js';
import { Effects } from '../src/ui/effects.js';
import { Screens } from '../src/ui/screens.js';
import { Hud } from '../src/ui/hud.js';
import type { View } from '../src/ui/palette.js';

// --- fakes ---

/** No-op 2d context: every method is a void fn, every set succeeds. */
function fakeCtx(): CanvasRenderingContext2D {
  const noop = (..._a: unknown[]): unknown => undefined;
  return new Proxy(
    {},
    {
      get: (_t, p) => (p === 'measureText' ? () => ({ width: 10 }) : noop),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
}

const fakeSprites = {
  entitySprite: (_name: string): HTMLCanvasElement => ({} as HTMLCanvasElement),
};

const VIEW: View = { w: 390, h: 844 };

/** A mechanics-shaped Warrior hero dropped into a Game for UI reads. */
function warriorHero() {
  return {
    x: 2,
    y: 3,
    hp: 20,
    ht: 20,
    name: 'warrior',
    sprite: 'hero_warrior',
    sight: 8,
    isAlive: () => true,
    pos: 3 * 32 + 2,
    paralysed: false,
    rooted: false,
    flying: false,
    buffs: {} as Record<string, { kind: string; left: number }>,
    str: 11,
    weakened: false,
    lvl: 1,
    exp: 0,
    attackSkill: 10,
    defenseSkill: 5,
    weapon: { name: 'short sword', tier: 1, level: 0, min: 1, max: 12, str: 11, acu: 1, dly: 1, missile: false },
    armor: { name: 'cloth armor', str: 9, dr: 2 },
    rangedWeapon: null,
    darts: 8,
    // ContentHero shape: the content inventory adapter (registered by
    // src/content/hooks.ts at module load) reads hero.inventory; the stub
    // must carry the starter kit or full-suite runs crash here.
    inventory: [
      { itemId: 'ration', qty: 1 },
      { itemId: 'dart', qty: 8 },
    ],
  };
}

function testGame(): Game {
  const g = new Game(1234, { gen: stubLevelGen, mechanics: stubMechanics });
  g.hero = warriorHero() as unknown as HeroActor;
  return g;
}

// --- heroView ---

describe('readHeroView', () => {
  test('warrior kit basics', () => {
    const hv = readHeroView(testGame());
    expect(hv.hp).toBe(20);
    expect(hv.ht).toBe(20);
    expect(hv.lvl).toBe(1);
    expect(hv.exp).toBe(0);
    expect(hv.maxExp).toBe(10); // 5 + 1*5
    expect(hv.str).toBe(11);
    expect(hv.hungry).toBe(false);
    expect(hv.starving).toBe(false);
    expect(hv.gold).toBe(0);
    expect(hv.buffs).toEqual([]);
  });

  test('hunger buff state surfaces', () => {
    const g = testGame();
    (g.hero as unknown as { buffs: Record<string, { kind: string; left: number }> }).buffs = {
      hunger: { kind: 'hunger', left: 300 },
    };
    const hv = readHeroView(g);
    expect(hv.hunger).toBe(300);
    expect(hv.hungry).toBe(true);
    expect(hv.starving).toBe(false);
  });

  test('buff list surfaces', () => {
    const g = testGame();
    (g.hero as unknown as { buffs: Record<string, { kind: string; left: number }> }).buffs = {
      burning: { kind: 'burning', left: 5 },
      ooze: { kind: 'ooze', left: 3 },
    };
    expect(readHeroView(g).buffs.sort()).toEqual(['burning', 'ooze']);
  });
});

// --- inventory ---

describe('inventory adapter', () => {
  test('warrior kit shown correctly', () => {
    // default adapter: assertions below encode its ids ('clotharmor'); the
    // global adapter is order-dependent (see note on defaultInventoryAdapter).
    const items = defaultInventoryAdapter(testGame());
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId['shortsword'].kind).toBe('weapon');
    expect(byId['shortsword'].equipped).toBe(true);
    expect(byId['shortsword'].sprite).toBe('shortsword');
    expect(byId['clotharmor'].kind).toBe('armor');
    expect(byId['clotharmor'].equipped).toBe(true);
    expect(byId['dart'].kind).toBe('missile');
    expect(byId['dart'].qty).toBe(8);
    expect(byId['ration'].kind).toBe('food');
    // slots are unique and dense
    const slots = items.map((i) => i.slot).sort((a, b) => a - b);
    expect(slots).toEqual([...Array(items.length).keys()]);
  });

  test('context-aware actions per item type', () => {
    // default adapter; see note in 'warrior kit shown correctly'.
    const items = defaultInventoryAdapter(testGame());
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(actionsFor(byId['shortsword'])).toEqual(['equip', 'drop']);
    expect(actionsFor(byId['dart'])).toEqual(['throw', 'drop']);
    expect(actionsFor(byId['ration'])).toEqual(['use', 'drop']);
  });

  test('doItemAction queues intents', () => {
    const queued: unknown[] = [];
    const fakeGame = { queueIntent: (i: unknown): void => void queued.push(i) };
    const items = defaultInventoryAdapter(testGame());
    const ration = items.find((i) => i.id === 'ration')!;
    expect(doItemAction(fakeGame as never, ration, 'use')).toBe('done');
    expect(queued[0]).toEqual({ kind: 'useItem', slot: ration.slot });
    const sword = items.find((i) => i.id === 'shortsword')!;
    expect(doItemAction(fakeGame as never, sword, 'equip')).toBe('done');
    expect(queued[1]).toEqual({ kind: 'equip', slot: sword.slot });
    const dart = items.find((i) => i.id === 'dart')!;
    expect(doItemAction(fakeGame as never, dart, 'throw')).toBe('throw-targeting');
    expect(queued.length).toBe(2); // throw needs targeting; nothing queued yet
  });
});

describe('InventoryPanel state', () => {
  test('toggle open/close and layout rows', () => {
    const p = new InventoryPanel();
    expect(p.open).toBe(false);
    p.toggle();
    expect(p.open).toBe(true);
    const items = readInventory(testGame());
    const L = p.layout(VIEW, items.length, items[0]);
    expect(L.rows.length).toBe(items.length);
    expect(L.actions.length).toBe(actionsFor(items[0]).length);
    expect(L.closeBtn.w).toBeGreaterThanOrEqual(44);
    p.close();
    expect(p.open).toBe(false);
  });

  test('draw does not crash headless', () => {
    const p = new InventoryPanel();
    p.toggle();
    expect(() => p.draw(fakeCtx(), testGame(), fakeSprites, VIEW)).not.toThrow();
  });
});

// --- log buffer ---

describe('LogBuffer', () => {
  test('sync picks up new lines and fades with age', () => {
    let now = 1000;
    const lb = new LogBuffer(() => now);
    expect(lb.sync(['a', 'b'])).toEqual(['a', 'b']);
    expect(lb.sync(['a', 'b'])).toEqual([]);
    expect(lb.sync(['a', 'b', 'c'])).toEqual(['c']);
    let vis = lb.visible(4);
    expect(vis.map((l) => l.text)).toEqual(['a', 'b', 'c']);
    expect(vis[0].alpha).toBe(1);
    now += 9000; // 9s later: fully faded but still listed
    vis = lb.visible(4);
    expect(vis[0].alpha).toBeCloseTo(0.22, 2);
    now += 100000;
    expect(lb.visible(2).length).toBe(2); // buffer keeps, UI shows last N
  });
});

// --- minimap ---

describe('minimap', () => {
  test('computeMinimap folds a real generated Sewers level without crashing', () => {
    const rng = new RNG(4242);
    const { level } = generateLevel(rng, 1, newRunState());
    // pretend the hero explored a chunk around the entrance
    for (let i = 0; i < level.size; i++) level.explored[i] = 1;
    const data = computeMinimap(level, []);
    expect(data.w).toBe(level.w);
    expect(data.h).toBe(level.h);
    expect(data.cells[level.stairsUp]).toBe(MM.stairsUp);
    expect(data.cells[level.stairsDown]).toBe(MM.stairsDown);
    // walls and floors both appear on a real level
    expect(data.cells).toContain(MM.wall);
    expect(data.cells).toContain(MM.floor);
  });

  test('unexplored cells stay unseen; mobs mark hostile on explored cells', () => {
    const rng = new RNG(7);
    const { level } = generateLevel(rng, 2, newRunState());
    const hx = 3;
    const hy = 3;
    level.explored[level.idx(hx, hy)] = 1;
    const data = computeMinimap(level, [{ x: hx, y: hy, hostile: true }]);
    expect(data.cells[level.idx(hx, hy)]).toBe(MM.mob);
    expect(data.cells[level.idx(0, 0)]).toBe(MM.unseen);
  });

  test('toggle + draw does not crash headless', () => {
    const m = new Minimap();
    expect(m.open).toBe(false);
    m.toggle();
    expect(m.open).toBe(true);
    const rng = new RNG(99);
    const { level } = generateLevel(rng, 5, newRunState());
    for (let i = 0; i < level.size; i++) level.explored[i] = 1;
    const g = new Game(99, { gen: stubLevelGen, mechanics: stubMechanics });
    g.level = level as never;
    expect(() => m.draw(fakeCtx(), g, VIEW, 1234)).not.toThrow();
  });
});

// --- effects ---

function fxGame() {
  return {
    hero: { x: 5, y: 5, hp: 20, lvl: 1 },
    mobs: [] as { id: number; x: number; y: number; hp: number; ht: number; name: string; sprite: string }[],
    level: { idx: (x: number, y: number): number => y * 32 + x, visible: new Uint8Array(32 * 32) },
    log: [] as string[],
  };
}

describe('Effects', () => {
  test('hero damage spawns a number + flash', () => {
    const fx = new Effects();
    const g = fxGame();
    fx.watch(g as never, 1000);
    g.hero.hp = 14;
    fx.watch(g as never, 1016);
    expect(fx.floatTexts.length).toBe(1);
    expect(fx.floatTexts[0].text).toBe('6');
    expect(fx.flashes_.length).toBe(1);
  });

  test('hero heal spawns a green number', () => {
    const fx = new Effects();
    const g = fxGame();
    fx.watch(g as never, 1000);
    g.hero.hp = 14;
    fx.watch(g as never, 1016);
    g.hero.hp = 18;
    fx.watch(g as never, 1032);
    const heal = fx.floatTexts.find((f) => f.text === '+4');
    expect(heal).toBeDefined();
  });

  test('mob death poofs and fires onMobDeath', () => {
    const fx = new Effects();
    let deaths = 0;
    fx.onMobDeath = () => deaths++;
    const g = fxGame();
    g.mobs.push({ id: 1, x: 6, y: 5, hp: 3, ht: 8, name: 'rat', sprite: 'mob_rat' });
    fx.watch(g as never, 1000);
    g.mobs = [];
    fx.watch(g as never, 1016);
    expect(deaths).toBe(1);
    expect(fx.particles_.length).toBeGreaterThan(0);
  });

  test('level-up fires a banner + burst', () => {
    const fx = new Effects();
    const g = fxGame();
    fx.watch(g as never, 1000);
    g.hero.lvl = 2;
    fx.watch(g as never, 1016);
    expect(fx.banner_?.text).toBe('LEVEL UP!');
    expect(fx.particles_.length).toBeGreaterThan(0);
  });

  test('goo pump-up telegraphs', () => {
    const fx = new Effects();
    const g = fxGame();
    const goo = { id: 9, x: 6, y: 6, hp: 80, ht: 80, name: 'Goo', sprite: 'mob_goo', pumpedUp: false };
    g.mobs.push(goo as never);
    fx.watch(g as never, 1000);
    expect(fx.gooTelegraphOn).toBe(false);
    (goo as unknown as { pumpedUp: boolean }).pumpedUp = true;
    fx.watch(g as never, 1016);
    expect(fx.gooTelegraphOn).toBe(true);
    expect(fx.floatTexts.some((f) => f.text === '!')).toBe(true);
  });

  test('draw does not crash headless (incl. boss bar)', () => {
    const fx = new Effects();
    const g = fxGame();
    const goo = { id: 9, x: 6, y: 6, hp: 60, ht: 80, name: 'Goo', sprite: 'mob_goo', pumpedUp: true };
    g.mobs.push(goo as never);
    (g.level.visible as Uint8Array)[6 * 32 + 6] = 1;
    fx.watch(g as never, 1000);
    const toScreen = (tx: number, ty: number): { x: number; y: number } => ({ x: tx * 48, y: ty * 48 });
    expect(() => fx.draw(fakeCtx(), g as never, toScreen, VIEW, 1000)).not.toThrow();
  });
});

// --- screens ---

describe('Screens', () => {
  test('title layout: Continue disabled without a save', () => {
    const s = new Screens();
    s.hasSave = () => false;
    const { buttons } = s.titleLayout(VIEW);
    expect(buttons.find((b) => b.id === 'continue')?.disabled).toBe(true);
    s.hasSave = () => true;
    expect(s.titleLayout(VIEW).buttons.find((b) => b.id === 'continue')?.disabled).toBe(false);
  });

  test('title tap routes: New Run starts, seed field focuses', () => {
    const s = new Screens();
    s.hasSave = () => false;
    let started = -1;
    s.onStartRun = (seed) => {
      started = seed;
    };
    const { buttons, seedRect } = s.titleLayout(VIEW);
    // tap the seed field -> editing
    (Screens as unknown as { lastView: View }).lastView = VIEW;
    expect(s.handleTap(seedRect.x + 4, seedRect.y + 4)).toBe(true);
    expect(s.seedEditing).toBe(true);
    // type digits
    s.handleKey({ key: '4', preventDefault: () => {} } as KeyboardEvent);
    s.handleKey({ key: '2', preventDefault: () => {} } as KeyboardEvent);
    expect(s.seedText).toBe('42');
    s.handleKey({ key: 'Enter', preventDefault: () => {} } as KeyboardEvent);
    expect(s.seedEditing).toBe(false);
    // tap New Run
    const nb = buttons.find((b) => b.id === 'new')!;
    s.handleTap(nb.rect.x + 4, nb.rect.y + 4);
    expect(started).toBe(42);
  });

  test('pause/help/dead transitions', () => {
    const s = new Screens();
    s.show('playing');
    s.show('paused');
    expect(
      s.handleKey({ key: 'Escape', preventDefault: () => {} } as KeyboardEvent),
    ).toBe(true);
    expect(s.state).toBe('playing');
  });

  test('draw does not crash headless for every screen', () => {
    const s = new Screens();
    s.hasSave = () => true;
    s.getSummary = () => ({ cause: 'killed by a rat', depth: 2, turns: 130, lvl: 2, kills: 5, gold: 42, seed: 7 });
    for (const st of ['title', 'paused', 'help', 'dead'] as const) {
      s.show(st);
      expect(() => s.draw(fakeCtx(), fakeSprites, VIEW, 500)).not.toThrow();
    }
  });
});

// --- hud smoke ---

describe('Hud', () => {
  test('draw does not crash headless', () => {
    const hud = new Hud();
    const g = testGame();
    g.logMsg('You descend to depth 1.');
    hud.logBuffer.sync(g.log);
    expect(() => hud.draw(fakeCtx(), g, fakeSprites, VIEW, { throwMode: false })).not.toThrow();
    const L = hud.layout(VIEW);
    expect(L.potionBtn.w).toBeGreaterThanOrEqual(44);
    expect(L.dartBtn.h).toBeGreaterThanOrEqual(44);
  });
});

describe('buff icon strip (bufficons.ts, BuffIndicator.java)', () => {
  test('M1 buffs map to their original 7x7 icons', async () => {
    const { buffIconKey } = await import('../src/ui/bufficons.js');
    expect(buffIconKey('burning')).toBe('bufficon_fire');
    expect(buffIconKey('poison')).toBe('bufficon_poison');
    expect(buffIconKey('paralysis')).toBe('bufficon_paralysis');
    expect(buffIconKey('ooze')).toBe('bufficon_ooze');
    expect(buffIconKey('roots')).toBe('bufficon_roots');
  });

  test('buffs with BuffIndicator.NONE map to null (hunger, sleep, regeneration)', async () => {
    const { buffIconKey } = await import('../src/ui/bufficons.js');
    expect(buffIconKey('hunger')).toBeNull();
    expect(buffIconKey('sleep')).toBeNull();
    expect(buffIconKey('regeneration')).toBeNull();
    expect(buffIconKey('unknown')).toBeNull();
  });

  test('strip keeps attach order, skips NONE, dedupes', async () => {
    const { buffStripKeys } = await import('../src/ui/bufficons.js');
    expect(buffStripKeys(['poison', 'hunger', 'burning', 'poison'])).toEqual([
      'bufficon_poison',
      'bufficon_fire',
    ]);
    expect(buffStripKeys(['hunger'])).toEqual([]);
  });

  test('icon pitch is vanilla (7+2) at 3x scale', async () => {
    const {
      buffIconX,
      BUFF_ICON_PX,
      BUFF_ICON_DRAW,
      BUFF_ICON_PITCH,
    } = await import('../src/ui/bufficons.js');
    expect(BUFF_ICON_PX).toBe(7);
    expect(BUFF_ICON_DRAW).toBe(21);
    expect(BUFF_ICON_PITCH).toBe(27);
    expect(buffIconX(8, 0)).toBe(8);
    expect(buffIconX(8, 3)).toBe(8 + 3 * 27);
  });

  test('removal poof: scale 1->6, fade over 0.6s (BuffIndicator.java)', async () => {
    const { removedIconTransform } = await import('../src/ui/bufficons.js');
    expect(removedIconTransform(1000, 1000)).toEqual({ scale: 1, alpha: 1 });
    expect(removedIconTransform(1000, 1300)).toEqual({ scale: 3.5, alpha: 0.5 });
    expect(removedIconTransform(1000, 1600)).toBeNull();
    expect(removedIconTransform(1000, 2000)).toBeNull();
  });

  test('trackRemovedIcons detects removals at their strip position', async () => {
    const { trackRemovedIcons, removedIconTransform } = await import(
      '../src/ui/bufficons.js'
    );
    const now = 5000;
    const live = trackRemovedIcons(
      { keys: ['bufficon_fire', 'bufficon_poison'], x0: 8 },
      ['bufficon_fire'],
      [],
      now,
    );
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ key: 'bufficon_poison', x: 8 + 27, at: now });
    // poof survives while the tween runs, expires after
    const kept = trackRemovedIcons({ keys: ['bufficon_fire'], x0: 8 }, ['bufficon_fire'], live, now + 300);
    expect(kept).toHaveLength(1);
    const gone = trackRemovedIcons({ keys: ['bufficon_fire'], x0: 8 }, ['bufficon_fire'], live, now + 700);
    expect(gone).toHaveLength(0);
    expect(removedIconTransform(live[0]!.at, now + 700)).toBeNull();
  });
});
