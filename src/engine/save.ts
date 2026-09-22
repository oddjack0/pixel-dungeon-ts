import { RNG } from '../core/rng.js';
import { Region } from '../core/grid.js';
import { Level, newRunState, type PlacedItem, type RunState } from '../dungeon/level.js';
import { Game } from './loop.js';
import {
  type HeroSaveData,
  type MechanicsHooks,
  type MobSaveData,
  mobsToPlaced,
} from './seams.js';
import {
  restoreQuestState,
  saveQuestState,
  type QuestSaveData,
} from '../content/npcs.js';

/**
 * Save/load full run state to localStorage (JSON).
 * Full format documented in docs/ENGINE-REPORT.md.
 */

export const SAVE_KEY = 'pdv2-save-1';
const SAVE_VERSION = 1;

interface LevelSaveData {
  w: number;
  h: number;
  depth: number;
  region: Region;
  tiles: number[];
  explored: number[];
  stairsUp: number;
  stairsDown: number;
  doors: number[];
  traps: number[];
  items: PlacedItem[];
  /** Boss-arena seal state (SewerBossLevel.seal/unseal). */
  sealed?: boolean;
  bossLevel?: boolean;
  /** Tengu arena bounds + door cell (the boss worker's runtime hook). */
  bossArena?: { l: number; t: number; r: number; b: number } | null;
  arenaDoorCell?: number;
  /** PrisonBossLevel bundle ENTERED/DROPPED (PrisonBossLevel.java:75-76). */
  enteredArena?: boolean;
  keyDropped?: boolean;
}

interface RunSaveData {
  version: number;
  seed: number;
  rngState: number;
  depth: number;
  turnCount: number;
  schedulerNow: number;
  gameOver: boolean;
  log: string[];
  level: LevelSaveData;
  hero: HeroSaveData;
  mobs: MobSaveData[];
  /** Per-run generation state (ghost/wandmaker/dew vial/scroll quota/weak floor). */
  run?: RunState;
  /**
   * Run-level quest state (vanilla Ghost.Quest / Wandmaker.Quest /
   * Blacksmith.Quest statics, saved by Dungeon.storeInBundle). Persists
   * across depth transitions (module singletons) and across save/load.
   */
  quests?: QuestSaveData;
}

export function hasSave(key: string = SAVE_KEY): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function clearSave(key: string = SAVE_KEY): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

export function saveGame(game: Game, mechanics: MechanicsHooks, key: string = SAVE_KEY): void {
  const lvl = game.level;
  const data: RunSaveData = {
    version: SAVE_VERSION,
    seed: game.seed,
    rngState: game.rng.serialize(),
    depth: lvl.depth,
    turnCount: game.turnCount,
    schedulerNow: game.scheduler.now,
    gameOver: game.gameOver,
    log: game.log,
    level: {
      w: lvl.w,
      h: lvl.h,
      depth: lvl.depth,
      region: lvl.region,
      tiles: Array.from(lvl.tiles),
      explored: Array.from(lvl.explored),
      stairsUp: lvl.stairsUp,
      stairsDown: lvl.stairsDown,
      doors: [...lvl.doors],
      traps: [...lvl.traps],
      items: lvl.items.map((it) => ({ ...it })),
      sealed: lvl.sealed,
      bossLevel: lvl.bossLevel,
      bossArena: lvl.bossArena ? { ...lvl.bossArena } : null,
      arenaDoorCell: lvl.arenaDoorCell,
      enteredArena: lvl.enteredArena,
      keyDropped: lvl.keyDropped,
    },
    hero: mechanics.saveHero(game.hero),
    mobs: game.mobs.map((m) => mechanics.saveMob(m)),
    run: { ...game.run },
    quests: saveQuestState(),
  };
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    game.logMsg(`Save failed: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Rebuild a Game from a save. The dungeon generator is NOT re-run: the level
 * is restored tile-for-tile from the save. `mechanics` must implement
 * reviveHero/reviveMob (their save blobs are mechanics-owned).
 * Returns null when no valid save exists.
 */
export function loadGame(
  mechanics: MechanicsHooks,
  key: string = SAVE_KEY,
): Game | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  let data: RunSaveData;
  try {
    data = JSON.parse(raw) as RunSaveData;
  } catch {
    return null;
  }
  if (data.version !== SAVE_VERSION || !data.level || !data.hero) return null;

  // Rebuild the level first; hand it to Game via a fixed LevelGen so the
  // constructor's normal boot path runs, then overwrite the actor state.
  const lvl = new Level(data.level.w, data.level.h);
  lvl.depth = data.level.depth;
  lvl.region = data.level.region;
  lvl.tiles = Uint8Array.from(data.level.tiles);
  lvl.explored = Uint8Array.from(data.level.explored);
  lvl.stairsUp = data.level.stairsUp;
  lvl.stairsDown = data.level.stairsDown;
  lvl.doors = [...data.level.doors];
  lvl.traps = [...data.level.traps];
  lvl.items = data.level.items.map((it) => ({ ...it }));
  // Seal state must survive a reload: tiles are restored tile-for-tile, so a
  // sealed entrance stays water; the flag keeps ascend blocked.
  lvl.sealed = data.level.sealed ?? false;
  lvl.bossLevel = data.level.bossLevel ?? false;
  lvl.bossArena = data.level.bossArena ? { ...data.level.bossArena } : null;
  lvl.arenaDoorCell = data.level.arenaDoorCell ?? -1;
  lvl.enteredArena = data.level.enteredArena ?? false;
  lvl.keyDropped = data.level.keyDropped ?? false;

  const rng = RNG.restore(data.seed, data.rngState);
  const game = new Game(data.seed, {
    gen: { generate: () => lvl },
    mechanics,
  });

  // Overwrite the freshly-booted placeholder state with the saved run.
  game.rng = rng;
  game.turnCount = data.turnCount;
  game.gameOver = data.gameOver;
  game.log = [...data.log];
  game.run = data.run ? { ...data.run } : newRunState();
  // Quest state is run-level (vanilla statics); restore the singletons so a
  // reloaded run keeps ghost/wandmaker/blacksmith progress.
  restoreQuestState(data.quests);

  const hero = mechanics.reviveHero(rng, data.hero);
  game.hero = hero;
  game.mobs = data.mobs.map((md) => mechanics.reviveMob(rng, md));
  game.level.mobs = mobsToPlaced(game.mobs);

  game.scheduler.clear();
  game.scheduler.now = data.schedulerNow;
  game.scheduler.add(hero);
  for (const m of game.mobs) game.scheduler.add(m);

  game.level.updateFov(hero.x, hero.y, hero.sight);
  // Blindness blackout on load too (Level.updateFieldOfView, Level.java:793).
  if ((hero as unknown as { buffs?: { blindness?: unknown } }).buffs?.blindness) {
    game.level.visible.fill(0);
  }
  return game;
}
