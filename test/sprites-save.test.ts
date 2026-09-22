import { describe, test, expect } from 'bun:test';
import { ORIGINAL_SPRITES } from '../src/assets/original_sprites.js';
import {
  blacksmithQuest,
  freshBlacksmithQuest,
  freshGhostQuest,
  freshWandmakerQuest,
  ghostQuest,
  resetQuestState,
  restoreQuestState,
  saveQuestState,
  wandmakerQuest,
} from '../src/content/npcs.js';
import { Game } from '../src/engine/loop.js';
import { loadGame, saveGame } from '../src/engine/save.js';
import { stubLevelGen } from '../src/dungeon/level.js';
import { stubMechanics } from '../src/engine/stubs.js';

/**
 * Worker 6 (Stage 2): Caves sprite extraction + quest-state save/load.
 *
 * Pixel-identity itself is verified at generation time by
 * scripts/extract_original_sprites.ts ("verified N/N pixel-identical");
 * these tests pin the Stage 2 slice keys, their dimensions, and the
 * quest-state bundle round-trip.
 */

/** In-memory localStorage shim (bun has no DOM storage). */
function installStorage(): void {
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
}

const STAGE2_TILES = [
  'tile_caves_wall',
  'tile_caves_floor',
  'tile_caves_door',
  'tile_caves_water',
  'tile_caves_grass',
  'tile_caves_trap',
  'tile_caves_chasm',
  'tile_caves_statue',
  'tile_caves_entrance',
  'tile_caves_exit',
];
const STAGE2_MOBS = [
  'mob_spinner',
  'mob_elemental',
  'mob_monk',
  'mob_dm300',
  'mob_bee',
  'npc_blacksmith',
];
const STAGE2_ITEMS = [
  'item_wand_magicmissile',
  'item_wand_firebolt',
  'item_wand_lightning',
  'item_wand_disintegration',
  'item_wand_avalanche',
  'item_wand_poison',
  'item_wand_amok',
  'item_wand_slowness',
  'item_wand_blink',
  'item_wand_teleportation',
  'item_wand_flock',
  'item_wand_regrowth',
  'item_wand_reach',
  'item_ring_accuracy',
  'item_ring_detection',
  'item_ring_elements',
  'item_ring_evasion',
  'item_ring_haggler',
  'item_ring_haste',
  'item_ring_herbalism',
  'item_ring_mending',
  'item_ring_power',
  'item_ring_satiety',
  'item_ring_shadows',
  'item_ring_thorns',
  'item_potion_experience',
  'item_potion_frost',
  'item_potion_invisibility',
  'item_potion_levitation',
  'item_potion_liquidflame',
  'item_potion_might',
  'item_potion_mindvision',
  'item_potion_paralyticgas',
  'item_potion_purity',
  'item_potion_toxicgas',
  'item_scroll_identify',
  'item_scroll_removecurse',
  'item_scroll_magicmapping',
  'item_scroll_teleportation',
  'item_scroll_recharging',
  'item_scroll_challenge',
  'item_scroll_terror',
  'item_scroll_lullaby',
  'item_scroll_psionicblast',
  'item_scroll_mirrorimage',
  'item_scroll_enchantment',
  'item_darkgold',
  'item_pickaxe',
  'item_honeypot',
];

describe('Stage 2 sprite extraction', () => {
  test('all 65 Stage 2 keys exist in ORIGINAL_SPRITES', () => {
    const keys = [...STAGE2_TILES, ...STAGE2_MOBS, ...STAGE2_ITEMS];
    expect(keys).toHaveLength(65);
    for (const k of keys) {
      expect(ORIGINAL_SPRITES[k], `missing sprite: ${k}`).toBeDefined();
    }
  });

  test('caves tiles are 16x16', () => {
    for (const k of STAGE2_TILES) {
      const s = ORIGINAL_SPRITES[k];
      expect(s.w, `${k} w`).toBe(16);
      expect(s.h, `${k} h`).toBe(16);
    }
  });

  test('item icons are 16x16 with complete RGBA payloads', () => {
    for (const k of STAGE2_ITEMS) {
      const s = ORIGINAL_SPRITES[k];
      expect(s.w, `${k} w`).toBe(16);
      expect(s.h, `${k} h`).toBe(16);
      const bin = Buffer.from(s.rgba, 'base64');
      expect(bin.length, `${k} bytes`).toBe(16 * 16 * 4);
    }
  });

  test('mob idle frames keep their Java TextureFilm sizes', () => {
    // SpinnerSprite 16x16, ElementalSprite 12x14 -> padded, MonkSprite
    // 15x14 -> padded, DM300Sprite 22x20 (larger than 16x16: kept natural),
    // BeeSprite 16x16, BlacksmithSprite 13x16 -> padded.
    expect([ORIGINAL_SPRITES['mob_spinner'].w, ORIGINAL_SPRITES['mob_spinner'].h]).toEqual([16, 16]);
    expect([ORIGINAL_SPRITES['mob_elemental'].w, ORIGINAL_SPRITES['mob_elemental'].h]).toEqual([16, 16]);
    expect([ORIGINAL_SPRITES['mob_monk'].w, ORIGINAL_SPRITES['mob_monk'].h]).toEqual([16, 16]);
    expect([ORIGINAL_SPRITES['mob_dm300'].w, ORIGINAL_SPRITES['mob_dm300'].h]).toEqual([22, 20]);
    expect([ORIGINAL_SPRITES['mob_bee'].w, ORIGINAL_SPRITES['mob_bee'].h]).toEqual([16, 16]);
    expect([ORIGINAL_SPRITES['npc_blacksmith'].w, ORIGINAL_SPRITES['npc_blacksmith'].h]).toEqual([16, 16]);
    const bin = Buffer.from(ORIGINAL_SPRITES['mob_dm300'].rgba, 'base64');
    expect(bin.length).toBe(22 * 20 * 4);
  });
});

describe('quest state save/load', () => {
  test('resetQuestState resets all three quests (incl. blacksmith)', () => {
    ghostQuest.given = true;
    ghostQuest.type = 'rat';
    wandmakerQuest.given = true;
    wandmakerQuest.wand1 = 'wand_avalanche';
    blacksmithQuest.spawned = true;
    blacksmithQuest.alternative = true;
    blacksmithQuest.given = true;
    blacksmithQuest.completed = true;
    blacksmithQuest.reforged = true;
    resetQuestState();
    expect(ghostQuest).toEqual(freshGhostQuest());
    expect(wandmakerQuest).toEqual(freshWandmakerQuest());
    expect(blacksmithQuest).toEqual(freshBlacksmithQuest());
  });

  test('saveQuestState snapshots; later mutation does not leak in', () => {
    resetQuestState();
    ghostQuest.spawned = true;
    ghostQuest.type = 'curse';
    ghostQuest.depth = 3;
    const snap = saveQuestState();
    ghostQuest.type = 'rose';
    expect(snap.ghost.type).toBe('curse');
    expect(snap.ghost.depth).toBe(3);
    resetQuestState();
  });

  test('restoreQuestState round-trips all three quests', () => {
    resetQuestState();
    Object.assign(ghostQuest, {
      spawned: true,
      type: 'rat',
      given: true,
      processed: false,
      depth: 4,
      left2kill: 5,
      weaponId: 'sword',
      armorId: 'armor_mail',
    });
    Object.assign(wandmakerQuest, {
      spawned: true,
      type: 'dust',
      given: true,
      wand1: 'wand_firebolt',
      wand2: 'wand_blink',
    });
    Object.assign(blacksmithQuest, {
      spawned: true,
      alternative: true,
      given: true,
      completed: false,
      reforged: false,
    });
    const snap = saveQuestState();
    resetQuestState();
    restoreQuestState(snap);
    expect(ghostQuest.type).toBe('rat');
    expect(ghostQuest.left2kill).toBe(5);
    expect(ghostQuest.weaponId).toBe('sword');
    expect(wandmakerQuest.type).toBe('dust');
    expect(wandmakerQuest.wand1).toBe('wand_firebolt');
    expect(blacksmithQuest.spawned).toBe(true);
    expect(blacksmithQuest.alternative).toBe(true);
    expect(blacksmithQuest.given).toBe(true);
    resetQuestState();
  });

  test('restoreQuestState(undefined) falls back to fresh state (old saves)', () => {
    ghostQuest.given = true;
    blacksmithQuest.spawned = true;
    restoreQuestState(undefined);
    expect(ghostQuest).toEqual(freshGhostQuest());
    expect(blacksmithQuest).toEqual(freshBlacksmithQuest());
  });

  test('saveGame/loadGame persists quest progress across sessions', () => {
    installStorage();
    resetQuestState();
    const g = new Game(4242, { gen: stubLevelGen, mechanics: stubMechanics });
    ghostQuest.spawned = true;
    ghostQuest.type = 'rose';
    ghostQuest.given = true;
    ghostQuest.depth = 2;
    wandmakerQuest.spawned = true;
    wandmakerQuest.type = 'berry';
    wandmakerQuest.wand1 = 'wand_avalanche';
    wandmakerQuest.wand2 = 'wand_regrowth';
    blacksmithQuest.spawned = true;
    blacksmithQuest.alternative = false;
    blacksmithQuest.given = true;
    saveGame(g, stubMechanics);

    // A fresh session starts from reset state, then loads.
    resetQuestState();
    expect(ghostQuest.given).toBe(false);
    const g2 = loadGame(stubMechanics);
    expect(g2).not.toBeNull();
    expect(ghostQuest.spawned).toBe(true);
    expect(ghostQuest.type).toBe('rose');
    expect(ghostQuest.given).toBe(true);
    expect(ghostQuest.depth).toBe(2);
    expect(wandmakerQuest.type).toBe('berry');
    expect(wandmakerQuest.wand1).toBe('wand_avalanche');
    expect(blacksmithQuest.spawned).toBe(true);
    expect(blacksmithQuest.alternative).toBe(false);
    expect(blacksmithQuest.given).toBe(true);
    resetQuestState();
  });
});
