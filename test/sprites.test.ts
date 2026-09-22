import { describe, test, expect } from "bun:test";
import {
  ART_PX,
  PALETTE,
  REGION_TINTS,
  SPRITES,
  validateSprites,
} from "../src/assets/sprites.js";

const EXPECTED_KEYS = [
  "hero", "hero_warrior",
  "floor0", "floor1", "wall",
  "door", "door_locked", "door_secret",
  "water", "grass", "chasm",
  "stairs_up", "stairs_down", "trap_revealed", "well", "chest",
  "mob_rat", "mob_gnoll", "mob_crab", "mob_swarm", "mob_skeleton",
  "mob_thief", "mob_goo",
  "shortsword", "dart", "potion_red", "potion_strength", "ration", "scroll",
  "armor_cloth", "gold", "key_iron", "key_skeleton",
];

describe("sprites atlas", () => {
  test("validateSprites reports no problems", () => {
    expect(validateSprites()).toEqual([]);
  });

  test("all M1 sprite keys exist", () => {
    for (const k of EXPECTED_KEYS) {
      expect(SPRITES[k], `missing sprite: ${k}`).toBeDefined();
    }
  });

  test("hero is the warrior alias", () => {
    expect(SPRITES["hero"]).toEqual(SPRITES["hero_warrior"]);
  });

  test("every sprite is 16x16 over the palette", () => {
    for (const [name, rows] of Object.entries(SPRITES)) {
      expect(rows.length, `${name} rows`).toBe(ART_PX);
      for (const row of rows) {
        expect(row.length, `${name} cols`).toBe(ART_PX);
        for (const ch of row) {
          expect(ch in PALETTE, `${name} char '${ch}'`).toBe(true);
        }
      }
    }
  });

  test("tintable ramp chars are used by floor/wall/secret-door", () => {
    for (const name of ["floor0", "floor1", "wall", "door_secret"]) {
      const chars = new Set(SPRITES[name].join("").split(""));
      expect(chars.has("F") || chars.has("f") || chars.has("W") || chars.has("w")).toBe(true);
    }
  });

  test("REGION_TINTS covers 5 regions incl. sewers", () => {
    for (const r of ["sewers", "prison", "caves", "city", "halls"]) {
      expect(REGION_TINTS[r], `missing region ${r}`).toBeDefined();
      for (const ch of ["F", "f", "W", "w"]) {
        expect(REGION_TINTS[r][ch], `${r}.${ch}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});

describe('original sprite extraction (scripts/extract_original_sprites.ts)', () => {
  // Lazy import: keeps the ASCII-atlas suite above independent.
  const load = () => import('../src/assets/original_sprites.js');

  test('all 32 buff icons extracted at 7x7', async () => {
    const { ORIGINAL_SPRITES } = await load();
    const names = [
      'mind_vision', 'levitation', 'fire', 'poison', 'paralysis', 'hunger',
      'starvation', 'slow', 'ooze', 'amok', 'terror', 'roots', 'invisible',
      'shadows', 'weakness', 'frost', 'blindness', 'combo', 'fury', 'healing',
      'armor', 'heart', 'light', 'cripple', 'barkskin', 'immunity', 'bleeding',
      'mark', 'deferred', 'vertigo', 'rage', 'sacrifice',
    ];
    expect(names).toHaveLength(32);
    for (const n of names) {
      const s = ORIGINAL_SPRITES[`bufficon_${n}`];
      expect(s, `missing bufficon_${n}`).toBeDefined();
      expect(s.w).toBe(7);
      expect(s.h).toBe(7);
    }
  });

  test('trap states, high grass and sign extracted at 16x16', async () => {
    const { ORIGINAL_SPRITES } = await load();
    const keys = [
      'trap_toxic_secret', 'trap_fire_secret', 'trap_paralytic_secret',
      'trap_inactive', 'trap_poison_secret', 'trap_alarm_secret',
      'trap_lightning_secret', 'trap_gripping_secret', 'trap_summoning_secret',
      'high_grass', 'sign',
    ];
    for (const k of keys) {
      const s = ORIGINAL_SPRITES[k];
      expect(s, `missing ${k}`).toBeDefined();
      expect(s.w).toBe(16);
      expect(s.h).toBe(16);
    }
  });

  test('every entry decodes to w*h*4 RGBA bytes', async () => {
    const { ORIGINAL_SPRITES } = await load();
    for (const [name, s] of Object.entries(ORIGINAL_SPRITES)) {
      const bin = atob(s.rgba);
      expect(bin.length, `${name} byte length`).toBe(s.w * s.h * 4);
    }
  });

  test('icons are distinct, non-blank 7x7 art', async () => {
    const { ORIGINAL_SPRITES } = await load();
    const seen = new Set<string>();
    for (const [name, s] of Object.entries(ORIGINAL_SPRITES)) {
      if (!name.startsWith('bufficon_')) continue;
      expect(seen.has(s.rgba), `${name} duplicates another icon`).toBe(false);
      seen.add(s.rgba);
      // non-blank: not every pixel identical
      const bin = atob(s.rgba);
      let varied = false;
      for (let i = 4; i < bin.length; i += 4) {
        if (bin[i] !== bin[0] || bin[i + 1] !== bin[1] || bin[i + 2] !== bin[2]) {
          varied = true;
          break;
        }
      }
      expect(varied, `${name} is blank`).toBe(true);
    }
    expect(seen.size).toBe(32);
  });

  test('secret trap tiles differ from their revealed tiles', async () => {
    const { ORIGINAL_SPRITES } = await load();
    const pairs: [string, string][] = [
      ['trap_toxic', 'trap_toxic_secret'],
      ['trap_fire', 'trap_fire_secret'],
      ['trap_paralytic', 'trap_paralytic_secret'],
      ['trap_poison', 'trap_poison_secret'],
      ['trap_alarm', 'trap_alarm_secret'],
      ['trap_lightning', 'trap_lightning_secret'],
      ['trap_gripping', 'trap_gripping_secret'],
      ['trap_summoning', 'trap_summoning_secret'],
    ];
    for (const [rev, sec] of pairs) {
      expect(ORIGINAL_SPRITES[rev]).toBeDefined();
      expect(ORIGINAL_SPRITES[sec]).toBeDefined();
      expect(ORIGINAL_SPRITES[sec]!.rgba).not.toBe(ORIGINAL_SPRITES[rev]!.rgba);
    }
  });
});
